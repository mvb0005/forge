import type { CardDto, CombatDto } from '../protocol'
import { CARD_RATIO, combatColumns, fitLane, groupBattlefield, placeLane, type Group, type LandPile, type LaneItem } from './layout'

// Turns two players' battlefields into positioned groups. Both front lanes share one tile size so
// blockers line up under (or over) the attacker they block. Coordinates are inside each half.

export type TileSpec = {
  key: string
  ids: number[]
  top: CardDto
  x: number
  y: number
  w: number
  attachTop: number
  shift: number
  role: Group['role']
  pile?: LandPile
}

export type SideLayout = { tiles: TileSpec[]; frontH: number; backH: number; columns: { key: string; x: number; w: number }[] }

export const PAD = 10
const LANE_GAP = 10
const FRONT = { minW: 44, slotX: 1.16 }
const BACK = { minW: 40, slotX: 1.14 }

function attachRows(groups: Group[]) {
  return Math.max(0, ...groups.map((g) => Math.min(2, g.top.attachmentIds.length)))
}

export function layoutTable(
  topCards: CardDto[],
  bottomCards: CardDto[],
  combat: CombatDto | null,
  highlighted: Set<string>,
  isVisible: (id: number) => boolean,
  size: { W: number; H: number }, // inner size of each battlefield (both halves are the same size)
  maxW: number,
  fold = false, // combat mode: the back lanes (lands, other permanents) give room to the front
): { top: SideLayout; bottom: SideLayout } {
  const lt = groupBattlefield(topCards, combat, { highlighted, isVisible })
  const lb = groupBattlefield(bottomCards, combat, { highlighted, isVisible })
  const { columns, topRest, bottomRest } = combatColumns(lt.creatures, lb.creatures)
  const inCombat = columns.length > 0 || [...topRest, ...bottomRest].some((g) => g.role)
  const W = Math.max(50, size.W - PAD * 2)
  const H = Math.max(50, size.H - PAD * 2)

  const sides = (['top', 'bottom'] as const).map((side) => {
    const lanes = side === 'top' ? lt : lb
    const rest = side === 'top' ? topRest : bottomRest
    // With the lands folded away (into the mana ribbon), other permanents join the front row.
    const ends = lanes.lands.length ? lanes.walkers : [...lanes.walkers, ...lanes.others]
    const front: LaneItem[] = [
      ...columns.map((c) => ({ key: c.key, slots: c.slots })),
      ...rest.map((g) => ({ key: g.key, slots: 1 })),
      ...ends.map((g) => ({ key: g.key, slots: 1, end: true })),
    ]
    const back: LaneItem[] = lanes.lands.length ? [...lanes.lands.map((p) => ({ key: p.key, slots: 1 })), ...lanes.others.map((g) => ({ key: g.key, slots: 1, end: true }))] : []
    const frontGroups = [...lanes.creatures, ...ends]
    const share = !back.length ? 1 : !front.length && !columns.length ? 0.38 : fold ? 0.74 : 0.6
    const frontH = share === 1 ? H : (H - LANE_GAP) * share
    const backH = share === 1 ? 0 : H - LANE_GAP - frontH
    const fAttach = attachRows(frontGroups) * 0.13
    const fCombat = inCombat ? 0.1 : 0
    const bAttach = attachRows(lanes.others) * 0.13
    return { side, lanes, rest, ends, front, back, frontH, backH, fAttach, fCombat, bAttach }
  })

  // Shared front tile size and step.
  const fits = sides.map((s) => fitLane(s.front, W, s.frontH, { ...FRONT, maxW, slotY: 1.04 + s.fAttach + s.fCombat }))
  // Lined-up combat needs one shared size; otherwise each side fits on its own.
  const shared = columns.length > 0
  const sharedW = Math.min(...fits.map((f) => f.w))
  const sharedStep = Math.min(...sides.map((s) => fitLane(s.front, W, s.frontH, { ...FRONT, maxW: sharedW, slotY: 1.04 + s.fAttach + s.fCombat }).step))

  const placed = sides.map((s, i) => {
    const w = shared ? sharedW : fits[i].w
    const step = shared ? sharedStep : fits[i].step
    const rowH = w * CARD_RATIO * (1.04 + s.fAttach + s.fCombat)
    return placeLane(s.front, W, s.frontH, w, step, rowH, s.side === 'top', !shared)
  })
  // Lined-up combat: both sides move together, so centre them by the wider side when each is one row.
  let dx = 0
  if (shared) {
    const extent = sides.map((s, i) => {
      const ys = new Set([...placed[i].values()].map((p) => p.y))
      if (ys.size > 1) return Infinity
      return Math.max(0, ...s.front.map((it) => placed[i].get(it.key)!.x + (it.slots - 1) * sharedStep + sharedW))
    })
    const widest = Math.max(...extent)
    if (widest < W) dx = (W - widest) / 2
  }

  const out = sides.map((s, i): SideLayout => {
    const w = shared ? sharedW : fits[i].w
    const step = shared ? sharedStep : fits[i].step
    const th = w * CARD_RATIO
    const tiles: TileSpec[] = []
    const isTop = s.side === 'top'
    const pos = new Map([...placed[i]].map(([k, p]) => [k, { x: p.x + dx, y: p.y }]))
    const frontY0 = isTop ? PAD + (s.backH ? s.backH + LANE_GAP : 0) : PAD
    const attachTop = th * s.fAttach + (isTop ? 0 : th * s.fCombat)
    const shiftAmt = th * 0.09 * (isTop ? 1 : -1)
    const push = (g: Group, x: number, y: number) =>
      tiles.push({ key: g.key, ids: g.ids, top: g.top, x: PAD + x, y: frontY0 + y, w, attachTop, shift: g.role ? shiftAmt : 0, role: g.role })
    const cols: SideLayout['columns'] = []
    for (const c of columns) {
      const p = pos.get(c.key)!
      cols.push({ key: c.key, x: PAD + p.x, w: (c.slots - 1) * step + w })
      ;(isTop ? c.top : c.bottom).forEach((g, i) => push(g, p.x + i * step, p.y))
    }
    for (const g of [...s.rest, ...s.ends]) {
      const p = pos.get(g.key)!
      push(g, p.x, p.y)
    }

    if (s.back.length) {
      const slotY = 1.08 + s.bAttach
      const bf = fitLane(s.back, W, s.backH, { ...BACK, maxW: Math.max(BACK.minW, Math.min(w * 0.92, maxW * 0.8)), slotY })
      const bth = bf.w * CARD_RATIO
      const bpos = placeLane(s.back, W, s.backH, bf.w, bf.step, bth * slotY, !isTop)
      const backY0 = isTop ? PAD : PAD + s.frontH + LANE_GAP
      const bAttachTop = bth * s.bAttach
      for (const p of s.lanes.lands) {
        const at = bpos.get(p.key)!
        const single = p.groups.length === 1
        const g = single ? p.groups[0] : null
        const top = g?.top ?? p.groups.find((x) => !x.top.tapped)?.top ?? p.groups[0].top
        tiles.push({ key: p.key, ids: p.ids, top, x: PAD + at.x, y: backY0 + at.y, w: bf.w, attachTop: bAttachTop, shift: 0, role: g?.role ?? null, pile: single ? undefined : p })
      }
      for (const g of s.lanes.others) {
        const at = bpos.get(g.key)!
        tiles.push({ key: g.key, ids: g.ids, top: g.top, x: PAD + at.x, y: backY0 + at.y, w: bf.w, attachTop: bAttachTop, shift: 0, role: g.role })
      }
    }
    return { tiles, frontH: s.frontH, backH: s.backH, columns: cols }
  })
  return { top: out[0], bottom: out[1] }
}

