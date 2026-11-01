import { orderedHand } from '../board/handOrder'
import { CARD_RATIO, buildGroups, combatRoles } from '../board/layout'
import { layoutTable, PAD, type SideLayout } from '../board/fieldLayout'
import { isShelfCard, shelfWidth, trayGroups } from '../board/lands'
import type { CardDto, PhaseName, PlayerDto } from '../protocol'
import type { LayoutFn, LayoutInput, LayoutResult, Placement, Region, TableMode } from './contract'
import { STACK, tableFrame, type Frame } from './frame'

// Layout functions per table mode. 'main' and 'combat' share one pass; combat lines attackers up
// against their blockers and folds the back lanes. With two or more opponents every player, you
// included, keeps a full-width band on every turn, and the active player's band is the tall one.
// Lands fold into the land shelf at the right end of their battlefield (invisible anchors there, so
// they fly in and out) unless one of them can be chosen right now or the player opened them.

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

/**
 * Every player's commanders sit at the left of their own battlefield, one slot each, whether the card is
 * there or not. The battlefield lays out in what's left, so the slots line up down the table.
 */
export const COMMAND = { gap: 6, pad: 8, chipH: 34, maxW: 132 }
/** Room a defender's band leaves at its left in combat (3-4 players) for the callout beside the player's border. */
export const CALLOUT_W = 300
const ENGAGE_MIN_H = 72 // shortest card in a fight row before the attackers wrap into another column
const ENGAGE_MAX_W = 220 // as large as the rest of the board: the fight is what matters now
/** The command zone inside a player border (3-4 players): commander cards stacked at the border's right edge. */
export const BORDER = { pad: 8, cardMaxW: 92, share: 0.42 }
export function borderCommandSlots(border: Region, n: number, bandH = border.h): Region[] {
  if (!n) return []
  const h0 = bandH - 2 * BORDER.pad // sized for the shortest band, so every border's slots line up
  const w = Math.max(30, Math.min(BORDER.cardMaxW, border.w * BORDER.share, h0 / CARD_RATIO))
  const h = w * CARD_RATIO
  const step = n > 1 ? Math.min(h * 0.32, (h0 - h) / (n - 1)) : 0
  const x = border.x + border.w - BORDER.pad - w
  const y = border.y + (border.h - (h + (n - 1) * step)) / 2
  return Array.from({ length: n }, (_, i) => ({ x, y: y + i * step, w, h }))
}
/** Card width for a slot in a field this tall. */
const commandCardW = (fieldH: number) => Math.max(36, Math.min(COMMAND.maxW, (fieldH - 2 * COMMAND.pad - COMMAND.chipH) / CARD_RATIO))
/** How much of the field's left edge the slots take: the widest player's, so every field starts at the same x. */
function commandCarve(players: (PlayerDto | undefined)[], fieldH: number) {
  const n = Math.max(0, ...players.map((p) => p?.commanders?.length ?? 0))
  if (!n) return 0
  const w = commandCardW(fieldH)
  return 2 * COMMAND.pad + n * w + (n - 1) * COMMAND.gap
}
export function commandSlots(field: Region, n: number, fieldH = field.h): Region[] {
  const w = commandCardW(fieldH)
  const h = w * CARD_RATIO
  const y = field.y + Math.max(COMMAND.pad, (field.h - h - COMMAND.chipH) / 2)
  return Array.from({ length: n }, (_, i) => ({ x: field.x + COMMAND.pad + i * (w + COMMAND.gap), y, w, h }))
}
const shrink = (r: Region, by: number): Region => (by ? { x: r.x + by, y: r.y, w: r.w - by, h: r.h } : r)
const trim = (r: Region, by: number): Region => (by ? { ...r, w: r.w - by } : r)

/** About this share of a battlefield's width goes to its land shelf at most. */
export const SHELF_MAX = 0.25
/**
 * How much of the right edge of each field the land shelves take: the widest player's shelf at the
 * height of their own field, so every field ends at the same x. Over the cap the shelves drop their
 * names; if that still doesn't fit, the cap gives way rather than hide a stack.
 */
export function landCarve(seats: { player: PlayerDto | undefined; h: number }[], cards: Record<number, CardDto>, fieldW: number) {
  const groups = seats.map(({ player, h }) => ({ h, g: player ? trayGroups(player.zones.battlefield.map((id) => cards[id]).filter((c): c is CardDto => !!c && isShelfCard(c))) : [] }))
  const need = (tight: boolean) => Math.max(0, ...groups.map(({ g, h }) => shelfWidth(g, h, tight)))
  return Math.round(Math.min(need(false), Math.max(fieldW * SHELF_MAX, need(true))))
}
/** The shelf: the right `carve` px of a field. */
export const shelfOf = (field: Region, carve: number): Region => ({ x: field.x + field.w - carve, y: field.y, w: carve, h: field.h })

const isFoldedLand = (c: CardDto) => c.types.includes('Land') && !c.types.includes('Creature') && c.attachedToId == null

/** A player's lands fold into their shelf unless they opened it or one of the lands can be chosen now. */
export function foldsLands(cards: CardDto[], selectable?: Set<number>, open = false) {
  return !open && (!selectable?.size || !cards.some((c) => isFoldedLand(c) && selectable.has(c.id)))
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

/**
 * A fight in the attacked player's band (3-4 players): one row per attacker (identical unblocked ones as one
 * tile), the attacker facing the player's border with its blockers standing between them, so an unblocked
 * attacker has nothing in its way. The rows sit at the left of the band, against the border; more attackers
 * than rows wrap into another column. Publishes `engage:<player>` (the fight, for its ring and the callout
 * beside it), `lane:col:<attacker>` and `slot:<attacker>` (where a blocker would stand, for the block slots).
 * Returns the defender's cards it placed as blockers.
 */
function engage(
  defender: number,
  field: Region,
  attackers: CardDto[],
  row: CardDto[],
  input: LayoutInput,
  regions: Record<string, Region>,
  put: (id: number, p: Placement) => void,
): Set<number> {
  const combat = input.combat!
  const groups = buildGroups(attackers, combatRoles(combat), input.highlighted)
  const mineIds = new Set(row.map((c) => c.id))
  const fights = groups.map((g) => {
    const ids = new Set(g.ids)
    const blockers = [...new Set(combat.bands.filter((b) => b.attackerIds.some((a) => ids.has(a))).flatMap((b) => [...b.blockerIds, ...b.plannedBlockerIds]))].filter((id) => mineIds.has(id))
    return { g, blockers }
  })
  const pad = 6
  const gap = 6
  const n = fights.length
  const spots = Math.max(1, ...fights.map((f) => f.blockers.length)) // room for a blocker even before one is chosen
  const H = field.h - 2 * pad
  let cols = 1
  while (cols < n && H / Math.ceil(n / cols) < ENGAGE_MIN_H) cols++
  const perCol = Math.ceil(n / cols)
  const cardH = Math.min(H / perCol - (perCol > 1 ? gap : 0), ENGAGE_MAX_W * CARD_RATIO)
  const w = cardH / CARD_RATIO
  const cellW = (spots + 1) * (w + gap)
  const used = new Set<number>()
  fights.forEach(({ g, blockers }, i) => {
    const c = Math.floor(i / perCol)
    const r = i % perCol
    const x0 = field.x + pad + c * (cellW + gap * 2)
    const y = field.y + pad + r * (cardH + gap)
    const ax = x0 + spots * (w + gap)
    const head = g.ids[0]
    put(head, {
      kind: 'field', x: ax, y, w, rot: 0, z: 2000 + i * 10, edge: 'bottom',
      count: g.ids.length > 1 ? g.ids.length : undefined,
      memberIds: g.ids.length > 1 ? g.ids.slice(1) : undefined,
    })
    blockers.forEach((id, k) => {
      used.add(id)
      put(id, { kind: 'field', x: ax - (k + 1) * (w + gap), y, w, rot: 0, z: 2000 + i * 10 + 1 + k, edge: 'top' })
    })
    regions[`lane:col:${head}`] = { x: x0, y, w: cellW - gap, h: cardH }
    regions[`slot:${head}`] = { x: ax - (blockers.length + 1) * (w + gap), y, w, h: cardH }
  })
  const rows = Math.min(n, perCol)
  regions[`engage:${defender}`] = { x: field.x, y: field.y, w: pad + cols * (cellW + gap * 2) - gap, h: 2 * pad + rows * cardH + (rows - 1) * gap }
  return used
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
  // In combat the attackers go to the player they attack (or whose planeswalker they attack): they line up
  // over that player's own creatures in the defender's band, which takes the extra height.
  const incoming = new Map<number, CardDto[]>()
  const moved = new Set<number>()
  if (combat && input.combat) {
    for (const b of input.combat.bands) {
      const d = b.defender
      const owner = !d ? null : d.kind === 'player' ? d.id : cards[d.id]?.controllerId ?? null
      if (owner == null || owner === active || !players[owner]) continue
      for (const a of b.attackerIds) {
        const c = cards[a]
        if (!c || moved.has(a)) continue
        moved.add(a)
        incoming.set(owner, [...(incoming.get(owner) ?? []), c])
      }
    }
  }
  const weight = (id: number) => (incoming.size ? (incoming.has(id) ? 2 : 1) : active != null && id === active ? 2 : 1)
  const inner = frame.top.h - gap * (order.length - 1)
  const sum = order.reduce((n, id) => n + weight(id), 0)
  const gutter = frame.oppSeat
  // The lands' shelf at the right end of every band, as wide as the widest player's (the commanders are in the border).
  const shelf = landCarve(order.map((id) => ({ player: players[id], h: inner * weight(id) / sum })), cards, frame.top.w)
  let y = frame.top.y
  const shortest = inner / sum
  const bands = order.map((id) => {
    const h = inner * weight(id) / sum
    const field: Region = { x: frame.top.x, y, w: frame.top.w, h }
    // Each band's left gutter is the player's border: life, name and counters, with the command zone
    // at its right edge. The lands' shelf is at the right end of the battlefield.
    const seat: Region = { x: gutter.x, y, w: gutter.w, h }
    const cmdIds = players[id]?.commanders?.map((c) => c.cardId) ?? []
    const slots = borderCommandSlots(seat, cmdIds.length, shortest)
    const ribbon = shelfOf(field, shelf)
    regions[`half:${id}`] = { x: gutter.x, y, w: field.x + field.w - gutter.x, h }
    regions[`seat:${id}`] = seat
    regions[`border:${id}`] = seat
    regions[`ribbon:${id}`] = ribbon
    regions[`field:${id}`] = field
    slots.forEach((r, i) => {
      const cid = cmdIds[i]
      regions[`command:${cid}`] = r
      if (cards[cid] && players[id]?.zones.command.includes(cid)) put(cid, { kind: 'command', x: r.x, y: r.y, w: r.w, rot: 0, z: 5900 + i })
    })
    y += h + gap
    return { id, field, cardsField: trim(field, shelf), ribbon, seat }
  })

  for (const band of bands) {
    const mine = band.id === meId
    const row = unfolded(players[band.id], band.ribbon).filter((c) => !moved.has(c.id))
    const attackers = incoming.get(band.id)
    const lane = combat ? { y: band.field.y, h: band.field.h } : null
    if (attackers?.length && input.combat) {
      const used = engage(band.id, band.cardsField, attackers, row, input, regions, put)
      // The rest of the defender's board keeps to the right of the fight, past room for their callout when
      // the rest of the board can spare it.
      const zone = regions[`engage:${band.id}`]
      const rest = row.filter((c) => !used.has(c.id))
      const right = band.cardsField.x + band.cardsField.w
      const free = right - (zone.x + zone.w + COL_GAP)
      const need = Math.min(free, 24 + rest.length * 90)
      const restX = zone.x + zone.w + COL_GAP + Math.max(0, Math.min(CALLOUT_W, free - need))
      const restF: Region = { x: restX, y: band.cardsField.y, w: Math.max(40, right - restX), h: band.cardsField.h }
      const size = { W: restF.w - 2, H: restF.h - 2 }
      const maxW = Math.min(220, Math.max(56, Math.min(size.W / 6, size.H / CARD_RATIO)))
      const shown = new Set(rest.map((c) => c.id))
      const lay = layoutTable(mine ? [] : rest, mine ? rest : [], null, input.highlighted, (id) => shown.has(id), size, maxW, false)
      paintSide(mine ? lay.bottom : lay.top, restF, mine ? 'top' : 'bottom', size, regions, cards, put, mine ? 'bottom:back' : null, null)
      continue
    }
    const size = { W: band.cardsField.w - 2, H: band.cardsField.h - 2 }
    const maxW = Math.min(220, Math.max(64, Math.min(size.W / 8, size.H / CARD_RATIO)))
    const shown = new Set(row.map((c) => c.id))
    const lay = layoutTable(mine ? [] : row, mine ? row : [], combat ? input.combat : null, input.highlighted, (id) => shown.has(id), size, maxW, combat)
    paintSide(mine ? lay.bottom : lay.top, band.cardsField, mine ? 'top' : 'bottom', size, regions, cards, put, mine ? 'bottom:back' : null, lane)
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
    if (!foldsLands(all, input.selectable, !!p && !!input.openLands?.includes(p.id))) return all
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
    const carve = commandCarve([opp, me], Math.min(frame.top.h, frame.bottom.h))
    const shelf = landCarve([{ player: opp, h: frame.top.h }, { player: me, h: frame.bottom.h }], cards, frame.top.w - carve)
    regions.oppRibbon = shelfOf(frame.top, shelf)
    regions.meRibbon = shelfOf(frame.bottom, shelf)
    const topCards = unfolded(opp, regions.oppRibbon)
    const botCards = unfolded(me, regions.meRibbon)
    const shown = new Set([...topCards, ...botCards].map((c) => c.id))
    const top = trim(shrink(frame.top, carve), shelf)
    const bottom = trim(shrink(frame.bottom, carve), shelf)
    const size = { W: Math.min(top.w, bottom.w) - 2, H: Math.min(top.h, bottom.h) - 2 }
    const maxW = Math.min(260, Math.max(90, size.W / 7))
    const sides = layoutTable(topCards, botCards, combat ? input.combat : null, input.highlighted, (id) => shown.has(id), size, maxW, combat)
    paintSide(sides.top, top, 'bottom', size, regions, cards, put, 'top:back', null)
    paintSide(sides.bottom, bottom, 'top', size, regions, cards, put, 'bottom:back', { y: frame.top.y, h: frame.bottom.y + frame.bottom.h - frame.top.y })
  }

  // Every player's commanders: a slot each at the left of their battlefield, the card face up in it while it's in
  // the command zone. With bands (3-4 players) they are in each player's border instead (placeBands).
  const handRow = frame.hand
  const seated: [PlayerDto | undefined, Region | undefined][] = fanout ? [] : [[opp, frame.top], [me, frame.bottom]]
  const slotH = fanout ? Math.min(...[...ids, meId].map((id) => regions[`field:${id}`]?.h ?? Infinity)) : Math.min(frame.top.h, frame.bottom.h)
  for (const [p, field] of seated) {
    const cmdIds = p?.commanders?.map((c) => c.cardId) ?? []
    if (!p || !field || !cmdIds.length) continue
    commandSlots(field, cmdIds.length, slotH).forEach((r, i) => {
      const id = cmdIds[i]
      regions[`command:${id}`] = r
      if (cards[id] && p.zones.command.includes(id)) put(id, { kind: 'command', x: r.x, y: r.y, w: r.w, rot: 0, z: 5900 + i })
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

  // Spells on the stack are drawn by the stack panel under the timeline (right-hand column): on the table
  // they head off that way and fade.
  stack.forEach((item, i) => {
    const id = item.sourceCardId
    if (id == null || cards[id]?.zone !== 'stack') return
    put(id, { kind: 'zone', x: frame.side.x - STACK.thumbW, y: frame.side.y + frame.side.h * 0.6, w: STACK.thumbW, rot: 0, z: 7000 - i, opacity: 0 })
  })

  // Invisible anchors at the piles and on the land shelves, so cards fly into and out of them.
  const anchor = (id: number, x: number, y: number) => put(id, { kind: 'zone', x, y, w: ZONE_W, rot: 0, z: 1, opacity: 0 })
  for (const [id, r] of folded) anchor(id, r.x + Math.max(0, (r.w - ZONE_W) / 2), r.y + 4)
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
