import { CARD_RATIO } from '../board/layout'
import { layoutTable, PAD } from '../board/fieldLayout'
import type { CardDto, PhaseName, PlayerDto } from '../protocol'
import type { LayoutFn, LayoutInput, LayoutResult, Placement, Region, TableMode } from './contract'
import { STACK, stackItemY, tableFrame } from './frame'

// Layout functions per table mode. 'main' and 'combat' share one pass; combat lines attackers up
// against their blockers and folds the back lanes. 'fanout' (M7) is the main layout for now.
// Lands fold into the player's mana ribbon (invisible anchors there, so they fly in and out) unless
// one of them can be chosen right now; then that player's lands are drawn as cards again.

const ZONE_W = 40
export const PILE_X = [0, 78, 156] // library, graveyard, exile/command inside the piles region

const isFoldedLand = (c: CardDto) => c.types.includes('Land') && !c.types.includes('Creature') && c.attachedToId == null

/** A player's lands fold into the ribbon unless one of them can be chosen now. */
export function foldsLands(cards: CardDto[], selectable?: Set<number>) {
  return !selectable?.size || !cards.some((c) => isFoldedLand(c) && selectable.has(c.id))
}
const PILE_SHOWN = 3 // newest cards of a graveyard/exile kept as anchors, so arrivals and departures fly

function table(input: LayoutInput, combat: boolean): LayoutResult {
  const { viewport, players, cards, meId, focusId, stack } = input
  const me = players[meId] as PlayerDto | undefined
  const opp = focusId != null ? players[focusId] : undefined
  const opps = Object.values(players).filter((p) => p.id !== meId)
  const frame = tableFrame(viewport, opps.length > 1, stack.length, combat)
  const placements = new Map<number, Placement>()
  const regions: Record<string, Region> = {}
  for (const [k, r] of Object.entries(frame)) if (r) regions[k] = r
  const put = (id: number, p: Placement) => {
    if (!placements.has(id)) placements.set(id, p)
  }

  // Battlefields: the focused opponent on top, you at the bottom.
  const list = (p?: PlayerDto) => (p ? p.zones.battlefield.map((id) => cards[id]).filter((c): c is CardDto => !!c) : [])
  const folded = new Map<number, Region>()
  const unfolded = (p: PlayerDto | undefined, ribbon: Region) => {
    const all = list(p)
    if (!foldsLands(all, input.selectable)) return all
    const rest: CardDto[] = []
    for (const c of all) {
      if (isFoldedLand(c)) folded.set(c.id, ribbon)
      else rest.push(c)
    }
    return rest
  }
  const topCards = unfolded(opp, frame.oppRibbon)
  const botCards = unfolded(me, frame.meRibbon)
  const shown = new Set([...topCards, ...botCards].map((c) => c.id))
  const size = { W: Math.min(frame.top.w, frame.bottom.w) - 2, H: Math.min(frame.top.h, frame.bottom.h) - 2 }
  const maxW = Math.min(260, Math.max(90, size.W / 7))
  const sides = layoutTable(topCards, botCards, combat ? input.combat : null, input.highlighted, (id) => shown.has(id), size, maxW, combat)
  for (const side of ['top', 'bottom'] as const) {
    const felt = frame[side]
    const ox = felt.x + 1
    const oy = felt.y + 1
    const edge = side === 'top' ? 'bottom' : 'top'
    const s = sides[side]
    if (s.backH > 0) {
      const lp = PAD - 4
      regions[`${side}:back`] = { x: ox + lp, y: side === 'top' ? oy + lp : oy + size.H - lp - s.backH - 8, w: size.W - 2 * lp, h: s.backH + 8 }
    }
    if (side === 'bottom') for (const c of s.columns) regions[`lane:${c.key}`] = { x: ox + c.x, y: frame.top.y, w: c.w, h: frame.bottom.y + frame.bottom.h - frame.top.y }
    for (const t of s.tiles) {
      const id = t.ids[0]
      const x = ox + t.x
      const y = oy + t.y + t.attachTop + t.shift
      const z = 100 + 3 * Math.round(x) // overlapping tiles stack left to right; independent of other tiles, so they don't re-render
      put(id, {
        kind: 'field',
        x,
        y,
        w: t.w,
        rot: t.top.tapped && t.role !== 'attacker' ? 90 : 0, // attackers stand upright in their lanes
        z,
        edge,
        count: t.ids.length > 1 ? t.ids.length : undefined,
        memberIds: t.ids.length > 1 ? t.ids.slice(1) : undefined,
        faceId: t.top.id !== id ? t.top.id : undefined,
        label: t.pile?.tapped ? `${t.pile.tapped} tapped` : undefined,
        pile: t.pile ? true : undefined,
      })
      const atts = t.top.attachmentIds.filter((a) => cards[a]?.zone === 'battlefield')
      const th = t.w * CARD_RATIO
      atts.forEach((a, i) => {
        const k = Math.min(i, 1)
        put(a, {
          kind: 'attach',
          x,
          y: y - (k + 1) * th * 0.13,
          w: t.w,
          rot: 0,
          z: z - 1 - k,
          edge,
          opacity: i < 2 ? undefined : 0,
          more: i === Math.min(atts.length, 2) - 1 && atts.length > 2 ? atts.length - 2 : undefined,
        })
      })
    }
  }

  // Your hand: fanned along the bottom.
  const hand = me ? me.zones.hand : []
  if (hand.length) {
    const { w: W, h: H } = frame.hand
    const n = hand.length
    const cw = Math.max(60, Math.min(170, (H + 18) / CARD_RATIO))
    const step = n > 1 ? Math.min(cw * 0.9, (W - cw - 16) / (n - 1)) : 0
    const x0 = (W - ((n - 1) * step + cw)) / 2
    const mid = (n - 1) / 2
    const tilt = Math.min(3.2, 18 / Math.max(1, n))
    hand.forEach((id, i) => {
      const d = i - mid
      put(id, { kind: 'hand', x: frame.hand.x + x0 + i * step, y: frame.hand.y + 6 + d * d * 0.9, w: cw, rot: d * tilt, z: 6000 + i })
    })
  }

  // Spells on the stack sit in their item's thumbnail slot.
  stack.forEach((item, i) => {
    const id = item.sourceCardId
    if (id == null || cards[id]?.zone !== 'stack') return
    const visible = i < STACK.shown
    put(id, {
      kind: visible ? 'stack' : 'zone',
      x: frame.stack.x + STACK.thumbX,
      y: frame.stack.y + frame.stack.h - (visible ? stackItemY(i) : 0) + STACK.thumbY,
      w: STACK.thumbW,
      rot: 0,
      z: 7000 + STACK.shown - i,
      opacity: visible ? undefined : 0,
    })
  })

  // Invisible anchors at the piles and in the mana ribbons, so cards fly into and out of them.
  const anchor = (id: number, x: number, y: number) => put(id, { kind: 'zone', x, y, w: ZONE_W, rot: 0, z: 1, opacity: 0 })
  for (const [id, r] of folded) anchor(id, r.x + 20, r.y)
  const pile = (ids: number[], x: number, y: number, n = PILE_SHOWN) => ids.slice(-n).forEach((id) => anchor(id, x, y))
  if (me) {
    const { x, y } = frame.piles
    pile(me.zones.graveyard, x + PILE_X[1], y + 8)
    pile(me.zones.exile, x + PILE_X[2], y + 8)
    pile(me.zones.command, x + PILE_X[2], y + 8)
  }
  if (opp) {
    const { x, y } = frame.oppSeat
    pile(opp.zones.graveyard, x + 20, y + 110)
    pile(opp.zones.exile, x + 60, y + 110)
    pile(opp.zones.command, x + 100, y + 110)
    pile(opp.zones.hand, x + 20, y + 90, opp.zones.hand.length)
  }

  return { placements, regions }
}

export const mainLayout: LayoutFn = (input) => table(input, false)
export const combatLayout: LayoutFn = (input) => table(input, true)
export const fanoutLayout: LayoutFn = mainLayout

export const LAYOUTS: Record<TableMode, LayoutFn> = { main: mainLayout, combat: combatLayout, fanout: fanoutLayout }

/** The table follows the turn: combat mode from the declare-attackers step on, while there is a combat. */
export const tableMode = (combat: LayoutInput['combat'], phase?: PhaseName | null): TableMode =>
  combat?.bands.length || phase === 'COMBAT_DECLARE_ATTACKERS' ? 'combat' : 'main'
