import { useEffect, useRef, useState } from 'react'
import type { CardDto, CombatDto } from '../protocol'
import { CARD_RATIO, combatColumns, fitLane, groupBattlefield, placeLane, type Group, type LandPile, type LaneItem } from './layout'
import { Tile } from './Tile'

// Turns two players' battlefields into positioned tiles. Both front lanes share one tile size so
// blockers line up under (or over) the attacker they block.

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

export type SideLayout = { tiles: TileSpec[]; frontH: number; backH: number }

const PAD = 10
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
    const front: LaneItem[] = [
      ...columns.map((c) => ({ key: c.key, slots: c.slots })),
      ...rest.map((g) => ({ key: g.key, slots: 1 })),
      ...lanes.walkers.map((g) => ({ key: g.key, slots: 1, end: true })),
    ]
    const back: LaneItem[] = [...lanes.lands.map((p) => ({ key: p.key, slots: 1 })), ...lanes.others.map((g) => ({ key: g.key, slots: 1, end: true }))]
    const frontGroups = [...lanes.creatures, ...lanes.walkers]
    const share = !back.length ? 1 : !front.length && !columns.length ? 0.38 : 0.6
    const frontH = share === 1 ? H : (H - LANE_GAP) * share
    const backH = share === 1 ? 0 : H - LANE_GAP - frontH
    const fAttach = attachRows(frontGroups) * 0.13
    const fCombat = inCombat ? 0.1 : 0
    const bAttach = attachRows(lanes.others) * 0.13
    return { side, lanes, rest, front, back, frontH, backH, fAttach, fCombat, bAttach }
  })

  // Shared front tile size and step.
  const fits = sides.map((s) => fitLane(s.front, W, s.frontH, { ...FRONT, maxW, slotY: 1.04 + s.fAttach + s.fCombat }))
  // Lined-up combat needs one shared size; otherwise each side fits on its own.
  const shared = columns.length > 0
  const sharedW = Math.min(...fits.map((f) => f.w))
  const sharedStep = Math.min(...sides.map((s) => fitLane(s.front, W, s.frontH, { ...FRONT, maxW: sharedW, slotY: 1.04 + s.fAttach + s.fCombat }).step))

  const out = sides.map((s, i): SideLayout => {
    const w = shared ? sharedW : fits[i].w
    const step = shared ? sharedStep : fits[i].step
    const th = w * CARD_RATIO
    const tiles: TileSpec[] = []
    const isTop = s.side === 'top'
    const rowH = th * (1.04 + s.fAttach + s.fCombat)
    const pos = placeLane(s.front, W, s.frontH, w, step, rowH, isTop)
    const frontY0 = isTop ? PAD + (s.backH ? s.backH + LANE_GAP : 0) : PAD
    const attachTop = th * s.fAttach + (isTop ? 0 : th * s.fCombat)
    const shiftAmt = th * 0.09 * (isTop ? 1 : -1)
    const push = (g: Group, x: number, y: number) =>
      tiles.push({ key: g.key, ids: g.ids, top: g.top, x: PAD + x, y: frontY0 + y, w, attachTop, shift: g.role ? shiftAmt : 0, role: g.role })
    for (const c of columns) {
      const p = pos.get(c.key)!
      ;(isTop ? c.top : c.bottom).forEach((g, i) => push(g, p.x + i * step, p.y))
    }
    for (const g of [...s.rest, ...s.lanes.walkers]) {
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
    return { tiles, frontH: s.frontH, backH: s.backH }
  })
  return { top: out[0], bottom: out[1] }
}

export function Battlefield({ layout, side }: { layout: SideLayout; side: 'top' | 'bottom' }) {
  const edge = side === 'top' ? 'bottom' : 'top'
  const lanePad = PAD - 4
  return (
    <div className="absolute inset-0">
      {layout.backH > 0 && (
        <div
          className="pointer-events-none absolute rounded-xl bg-table/35"
          style={{
            left: lanePad,
            right: lanePad,
            height: layout.backH + 8,
            top: side === 'top' ? lanePad : undefined,
            bottom: side === 'bottom' ? lanePad : undefined,
          }}
        />
      )}
      {layout.tiles.map((t) =>
        t.pile ? (
          <LandPileTile key={t.key} spec={t} edge={edge} />
        ) : (
          <Tile key={t.key} ids={t.ids} top={t.top} x={t.x} y={t.y} w={t.w} attachTop={t.attachTop} shift={t.shift} role={t.role} edge={edge} />
        ),
      )}
    </div>
  )
}

/** A land pile with more than one kind of copy (e.g. some tapped): collapsed, expands on hover. */
function LandPileTile({ spec, edge }: { spec: TileSpec; edge: 'top' | 'bottom' }) {
  const pile = spec.pile!
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const enter = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), 220)
  }
  const leave = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(false), 160)
  }
  const label = pile.tapped ? `${pile.tapped} tapped` : undefined
  const ew = Math.max(spec.w, 62)
  const estep = ew * 1.16
  const eth = ew * CARD_RATIO
  const panelW = (pile.groups.length - 1) * estep + ew + 20
  const panelH = eth + 34
  return (
    <>
      <Tile ids={spec.ids} top={spec.top} x={spec.x} y={spec.y} w={spec.w} attachTop={spec.attachTop} shift={0} role={null} edge={edge} label={label} onEnter={enter} onLeave={leave} />
      {open && (
        <div
          className="bf-pop absolute z-40 rounded-xl border border-line bg-panel/95 shadow-2xl backdrop-blur"
          style={{
            left: Math.max(4, spec.x - 10),
            top: edge === 'top' ? spec.y - panelH - 6 : spec.y + spec.w * CARD_RATIO + 14,
            width: panelW,
            height: panelH,
          }}
          onMouseEnter={() => window.clearTimeout(timer.current)}
          onMouseLeave={leave}
        >
          <div className="px-2.5 pt-1.5 text-[11px] font-semibold text-ink-dim">
            {pile.name} ×{pile.ids.length}
            {pile.tapped ? ` · ${pile.tapped} tapped` : ''}
          </div>
          <div className="relative" style={{ marginTop: 4 }}>
            {pile.groups.map((g, i) => (
              <Tile key={g.key} ids={g.ids} top={g.top} x={10 + i * estep} y={0} w={ew} attachTop={0} shift={0} role={g.role} edge={edge} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
