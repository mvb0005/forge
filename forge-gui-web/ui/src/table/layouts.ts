import { CARD_RATIO } from '../board/layout'
import { layoutTable, PAD, type SideLayout } from '../board/fieldLayout'
import type { CardDto, CombatDto, PhaseName, PlayerDto } from '../protocol'
import type { LayoutFn, LayoutInput, LayoutResult, Placement, Region, TableMode } from './contract'
import { COL_HEAD, RIBBON_H, STACK, stackItemY, tableFrame, type Frame } from './frame'

// Layout functions per table mode. 'main' and 'combat' share one pass; combat lines attackers up
// against their blockers and folds the back lanes. On your turn, with two or more opponents, the
// top half becomes one column per opponent and each defender's combat stays in that column.
// 'fanout' (Tab, Q-09) is still the main layout. Lands fold into the mana ribbon (invisible anchors
// there, so they fly in and out) unless one of them can be chosen right now; then that player's
// lands are drawn as cards again.

const COL_GAP = 8

/** Your turn — a local player is active — with two or more opponents: draw every opponent battlefield. */
export function showEveryOpponent(game: { activePlayerId: number | null; localPlayerIds: number[] }, opponents: number) {
  const active = game.activePlayerId
  return opponents >= 2 && active != null && game.localPlayerIds.includes(active)
}

/** Opponents in turn order, or by id when the game has no turn order. */
export function opponentIds(players: Record<number, PlayerDto>, meId: number, turnOrder?: number[]): number[] {
  const ids = Object.keys(players).map(Number).filter((id) => id !== meId)
  if (turnOrder?.length) {
    const rank = new Map(turnOrder.map((id, i) => [id, i]))
    ids.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || a - b)
  } else ids.sort((a, b) => a - b)
  return ids
}

function defenderSeat(band: CombatDto['bands'][number], cards: Record<number, CardDto>, seats: Set<number>) {
  const d = band.defender
  if (!d) return null
  if (d.kind === 'player') return seats.has(d.id) ? d.id : null
  const ctrl = cards[d.id]?.controllerId
  return ctrl != null && seats.has(ctrl) ? ctrl : null
}

const ZONE_W = 40
export const PILE_X = [0, 78, 156] // library, graveyard, exile/command inside the piles region

const isFoldedLand = (c: CardDto) => c.types.includes('Land') && !c.types.includes('Creature') && c.attachedToId == null

/** A player's lands fold into the ribbon unless one of them can be chosen now. */
export function foldsLands(cards: CardDto[], selectable?: Set<number>) {
  return !selectable?.size || !cards.some((c) => isFoldedLand(c) && selectable.has(c.id))
}
const PILE_SHOWN = 3 // newest cards of a graveyard/exile kept as anchors, so arrivals and departures fly

function paintSide(
  s: SideLayout,
  felt: Region,
  edge: 'top' | 'bottom',
  size: { W: number; H: number },
  regions: Record<string, Region>,
  cards: Record<number, CardDto>,
  put: (id: number, p: Placement) => void,
  backKey: string | null,
  lane: { y: number; h: number } | null,
) {
  const ox = felt.x + 1
  const oy = felt.y + 1
  const opponent = edge === 'bottom'
  if (s.backH > 0 && backKey) {
    const lp = PAD - 4
    regions[backKey] = { x: ox + lp, y: opponent ? oy + lp : oy + size.H - lp - s.backH - 8, w: size.W - 2 * lp, h: s.backH + 8 }
  }
  if (lane) for (const c of s.columns) regions[`lane:${c.key}`] = { x: ox + c.x, y: lane.y, w: c.w, h: lane.h }
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

function placeColumns(
  input: LayoutInput,
  combat: boolean,
  frame: Frame,
  ids: number[],
  regions: Record<string, Region>,
  placements: Map<number, Placement>,
  put: (id: number, p: Placement) => void,
  unfolded: (p: PlayerDto | undefined, ribbon: Region) => CardDto[],
) {
  const { players, cards, meId } = input
  const me = players[meId]
  const n = ids.length
  const gap = COL_GAP
  const colW = (frame.top.w - gap * (n - 1)) / n
  const seats = new Set(ids)
  const cols = ids.map((id, i) => {
    const field: Region = { x: frame.top.x + i * (colW + gap), y: frame.top.y, w: colW, h: frame.top.h }
    const ribbon: Region = { x: field.x, y: field.y - RIBBON_H, w: field.w, h: RIBBON_H }
    const seat: Region = { x: field.x, y: ribbon.y - COL_HEAD, w: field.w, h: COL_HEAD }
    const half: Region = { x: field.x, y: seat.y, w: field.w, h: frame.split.y - seat.y }
    regions[`half:${id}`] = half
    regions[`seat:${id}`] = seat
    regions[`ribbon:${id}`] = ribbon
    regions[`field:${id}`] = field
    return { id, field, ribbon, seat }
  })

  const myAll = unfolded(me, frame.meRibbon)
  const myById = new Map(myAll.map((c) => [c.id, c]))
  const bySeat = new Map<number, Set<number>>()
  for (const band of input.combat?.bands ?? []) {
    const seat = defenderSeat(band, cards, seats)
    if (seat == null) continue
    const set = bySeat.get(seat) ?? new Set<number>()
    for (const id of band.attackerIds) if (myById.has(id)) set.add(id)
    if (set.size) bySeat.set(seat, set)
  }
  const hostIds = new Set<number>()
  for (const set of bySeat.values()) for (const id of set) hostIds.add(id)
  const withHost = (set: Set<number> | undefined) => {
    if (!set?.size) return [] as CardDto[]
    const out: CardDto[] = []
    for (const c of myAll) if (set.has(c.id) || (c.attachedToId != null && set.has(c.attachedToId))) out.push(c)
    return out
  }
  const rest = myAll.filter((c) => !hostIds.has(c.id) && !(c.attachedToId != null && hostIds.has(c.attachedToId)))
  const laneH = frame.bottom.y + frame.bottom.h - frame.top.y

  for (const col of cols) {
    const theirs = unfolded(players[col.id], col.ribbon)
    const mine = withHost(bySeat.get(col.id))
    const size = { W: col.field.w - 2, H: col.field.h - 2 }
    const maxW = Math.min(260, Math.max(90, size.W / 7))
    const shown = new Set([...theirs, ...mine].map((c) => c.id))
    const lay = layoutTable(theirs, mine, mine.length ? input.combat : null, input.highlighted, (id) => shown.has(id), size, maxW, combat)
    paintSide(lay.top, col.field, 'bottom', size, regions, cards, put, null, null)
    if (mine.length) {
      paintSide(lay.bottom, { x: col.field.x, y: frame.bottom.y, w: col.field.w, h: frame.bottom.h }, 'top', size, regions, cards, put, null, { y: col.field.y, h: laneH })
    }
  }

  let attackH = 0
  if (hostIds.size) {
    let low = frame.bottom.y
    for (const p of placements.values()) {
      if (p.edge === 'top' && p.kind === 'field') low = Math.max(low, p.y + p.w * CARD_RATIO)
    }
    attackH = Math.min(low - frame.bottom.y + 8, Math.max(0, frame.bottom.h - 72))
  }
  const restFelt: Region = { x: frame.bottom.x, y: frame.bottom.y + attackH, w: frame.bottom.w, h: Math.max(36, frame.bottom.h - attackH) }
  const restSize = { W: restFelt.w - 2, H: restFelt.h - 2 }
  const restMax = Math.min(260, Math.max(90, restSize.W / 7))
  const restShown = new Set(rest.map((c) => c.id))
  const restLay = layoutTable([], rest, hostIds.size ? null : combat ? input.combat : null, input.highlighted, (id) => restShown.has(id), restSize, restMax, combat)
  const restLane = hostIds.size || !combat ? null : { y: frame.top.y, h: frame.bottom.y + frame.bottom.h - frame.top.y }
  paintSide(restLay.bottom, restFelt, 'top', restSize, regions, cards, put, 'bottom:back', restLane)
  return cols
}

function table(input: LayoutInput, combat: boolean): LayoutResult {
  const { viewport, players, cards, meId, focusId, stack } = input
  const me = players[meId] as PlayerDto | undefined
  const ids = opponentIds(players, meId, input.game.turnOrder)
  const fanout = showEveryOpponent(input.game, ids.length)
  const opp = !fanout && focusId != null ? players[focusId] : undefined
  const frame = tableFrame(viewport, !fanout && ids.length > 1, stack.length, combat, fanout)
  const placements = new Map<number, Placement>()
  const regions: Record<string, Region> = {}
  for (const [k, r] of Object.entries(frame)) if (r) regions[k] = r
  const put = (id: number, p: Placement) => {
    if (!placements.has(id)) placements.set(id, p)
  }

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

  const cols = fanout ? placeColumns(input, combat, frame, ids, regions, placements, put, unfolded) : null
  if (!fanout) {
    // One opponent full size on top, you at the bottom. Other opponents are strips.
    const topCards = unfolded(opp, frame.oppRibbon)
    const botCards = unfolded(me, frame.meRibbon)
    const shown = new Set([...topCards, ...botCards].map((c) => c.id))
    const size = { W: Math.min(frame.top.w, frame.bottom.w) - 2, H: Math.min(frame.top.h, frame.bottom.h) - 2 }
    const maxW = Math.min(260, Math.max(90, size.W / 7))
    const sides = layoutTable(topCards, botCards, combat ? input.combat : null, input.highlighted, (id) => shown.has(id), size, maxW, combat)
    paintSide(sides.top, frame.top, 'bottom', size, regions, cards, put, 'top:back', null)
    paintSide(sides.bottom, frame.bottom, 'top', size, regions, cards, put, 'bottom:back', { y: frame.top.y, h: frame.bottom.y + frame.bottom.h - frame.top.y })
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
  if (cols) {
    for (const col of cols) {
      const p = players[col.id]
      if (!p) continue
      const { x, y } = col.seat
      pile(p.zones.graveyard, x + 16, y + 8)
      pile(p.zones.exile, x + 52, y + 8)
      pile(p.zones.command, x + 88, y + 8)
      pile(p.zones.hand, x + 16, y + 4, p.zones.hand.length)
    }
  } else if (opp) {
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
