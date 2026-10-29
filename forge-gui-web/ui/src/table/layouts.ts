import { orderedHand } from '../board/handOrder'
import { CARD_RATIO } from '../board/layout'
import { layoutTable, PAD, type SideLayout } from '../board/fieldLayout'
import type { CardDto, PhaseName, PlayerDto } from '../protocol'
import type { LayoutFn, LayoutInput, LayoutResult, Placement, Region, TableMode } from './contract'
import { STACK, stackItemY, tableFrame, type Frame } from './frame'

// Layout functions per table mode. 'main' and 'combat' share one pass; combat lines attackers up
// against their blockers and folds the back lanes. With two or more opponents every player, you
// included, keeps a full-width band on every turn, and the active player's band is the tall one.
// Lands fold into the mana ribbon (invisible anchors there, so they fly in and out) unless one of
// them can be chosen right now.

const COL_GAP = 8

/** Two or more opponents: every player's battlefield stays up, whoever's turn it is. */
export function showEveryOpponent(opponents: number) {
  return opponents >= 2
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

const ZONE_W = 40
export const PILE_X = [0, 78, 156] // library, graveyard, exile/command inside the piles region

/** Your commanders' slots: in the empty corner below the seats when every player is a band, else left of the hand. */
export const COMMAND = { gap: 6, pad: 6, chipH: 24 }
export function commandSlots(frame: Frame, fanout: boolean, n: number): { region: Region; cards: Region[] } {
  const area = fanout ? frame.meSeat : frame.hand
  const h = Math.max(40, area.h - COMMAND.chipH - COMMAND.pad)
  let w = h / CARD_RATIO
  if (fanout) w = Math.min(w, (area.w - 2 * COMMAND.pad - (n - 1) * COMMAND.gap) / n)
  const total = n * w + (n - 1) * COMMAND.gap
  const x0 = fanout ? area.x + (area.w - total) / 2 : area.x + COMMAND.pad
  const cards = Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + COMMAND.gap), y: area.y + COMMAND.pad, w, h: w * CARD_RATIO }))
  const region = fanout ? area : { x: area.x, y: area.y, w: total + 2 * COMMAND.pad, h: area.h }
  return { region, cards }
}

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

function placeBands(
  input: LayoutInput,
  combat: boolean,
  frame: Frame,
  ids: number[],
  regions: Record<string, Region>,
  put: (id: number, p: Placement) => void,
  unfolded: (p: PlayerDto | undefined, ribbon: Region) => CardDto[],
) {
  const { players, cards, meId } = input
  const order = [...ids, meId]
  const gap = COL_GAP
  const active = input.game.activePlayerId
  const weight = (id: number) => (active != null && id === active ? 2 : 1)
  const inner = frame.top.h - gap * (order.length - 1)
  const sum = order.reduce((n, id) => n + weight(id), 0)
  const gutter = frame.oppSeat
  let y = frame.top.y
  const bands = order.map((id) => {
    const h = inner * weight(id) / sum
    const field: Region = { x: frame.top.x, y, w: frame.top.w, h }
    // The chip sits in the dark column beside the mat, and stops above the control panel.
    const seatBottom = Math.min(y + h, frame.act.y - 4)
    const seatH = Math.max(44, seatBottom - y)
    const seat: Region = { x: frame.act.x, y: seatBottom - seatH, w: frame.act.w, h: seatH }
    const ribbonH = Math.min(56, h)
    const ribbon: Region = { x: gutter.x, y: y + h - ribbonH, w: gutter.w, h: ribbonH }
    regions[`half:${id}`] = { x: gutter.x, y, w: field.x + field.w - gutter.x, h }
    regions[`seat:${id}`] = seat
    regions[`ribbon:${id}`] = ribbon
    regions[`field:${id}`] = field
    y += h + gap
    return { id, field, ribbon, seat }
  })

  for (const band of bands) {
    const mine = band.id === meId
    const row = unfolded(players[band.id], band.ribbon)
    const size = { W: band.field.w - 2, H: band.field.h - 2 }
    const maxW = Math.min(220, Math.max(64, Math.min(size.W / 8, size.H / CARD_RATIO)))
    const shown = new Set(row.map((c) => c.id))
    const lay = layoutTable(mine ? [] : row, mine ? row : [], combat ? input.combat : null, input.highlighted, (id) => shown.has(id), size, maxW, combat)
    const lane = combat ? { y: band.field.y, h: band.field.h } : null
    paintSide(mine ? lay.bottom : lay.top, band.field, mine ? 'top' : 'bottom', size, regions, cards, put, mine ? 'bottom:back' : null, lane)
  }

  const opp = ids.map((id) => regions[`field:${id}`]).filter((r): r is Region => !!r)
  if (opp.length) {
    const y0 = Math.min(...opp.map((f) => f.y))
    const y1 = Math.max(...opp.map((f) => f.y + f.h))
    regions.top = { x: frame.top.x, y: y0, w: frame.top.w, h: y1 - y0 }
  }
  const mineField = regions[`field:${meId}`]
  if (mineField) {
    regions.bottom = mineField
    regions.split = { x: 0, y: mineField.y, w: frame.split.w, h: 0 }
  }
  return bands
}

function table(input: LayoutInput, combat: boolean): LayoutResult {
  const { viewport, players, cards, meId, focusId, stack } = input
  const me = players[meId] as PlayerDto | undefined
  const ids = opponentIds(players, meId, input.game.turnOrder)
  const fanout = showEveryOpponent(ids.length)
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

  const cols = fanout ? placeBands(input, combat, frame, ids, regions, put, unfolded) : null
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

  // Your commanders, face up in their slots while they are in the command zone. Off the fanned table the slot takes the left of the hand row.
  const cmdIds = me?.commanders?.map((c) => c.cardId) ?? []
  let handRow = frame.hand
  if (cmdIds.length) {
    const slots = commandSlots(frame, fanout, cmdIds.length)
    regions.command = slots.region
    if (!fanout) handRow = { ...frame.hand, x: frame.hand.x + slots.region.w + COL_GAP, w: frame.hand.w - slots.region.w - COL_GAP }
    cmdIds.forEach((id, i) => {
      const r = slots.cards[i]
      regions[`command:${id}`] = r
      if (cards[id] && me!.zones.command.includes(id)) put(id, { kind: 'command', x: r.x, y: r.y, w: r.w, rot: 0, z: 5900 + i })
    })
  }

  // Your hand: fanned along the bottom, in mana-value order unless you have arranged it.
  const hand = me ? orderedHand(me.zones.hand, cards, input.handOrder ?? null) : []
  if (hand.length) {
    const { w: W, h: H } = handRow
    const n = hand.length
    const cw = Math.max(60, Math.min(170, (H + 18) / CARD_RATIO))
    const step = n > 1 ? Math.min(cw * 0.9, (W - cw - 16) / (n - 1)) : 0
    const x0 = (W - ((n - 1) * step + cw)) / 2
    const mid = (n - 1) / 2
    const tilt = Math.min(3.2, 18 / Math.max(1, n))
    hand.forEach((id, i) => {
      const d = i - mid
      put(id, { kind: 'hand', x: handRow.x + x0 + i * step, y: handRow.y + 6 + d * d * 0.9, w: cw, rot: d * tilt, z: 6000 + i })
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
