import { createPortal } from 'react-dom'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CardImage } from '../board/CardImage'
import { groupBattlefield } from '../board/layout'
import { clickCards, HeldExile, useCardLook } from '../board/Tile'
import { useBoardUi } from '../board/uiStore'
import { CardFrame, DESIGN_H, DESIGN_W } from '../look/CardFrame'
import { grownRect } from '../popover/place'
import { peekTimer, usePopover } from '../popover/store'
import { usePeek } from '../popover/usePeek'
import type { CardDto } from '../protocol'
import { useForge } from '../store'
import { peekKey } from './peek'
import type { LayoutResult, Placement } from './contract'
import { tableFrame } from './frame'
import { LAYOUTS, tableMode } from './layouts'
import { seatIds, tableSignature } from './signature'

// The one card layer: every visible card is a single absolutely positioned element keyed by id,
// placed by the layout function for the current table mode. When a placement changes, the element
// animates there with FLIP (transform and opacity only, from numbers we already have, so no layout
// reads). Cards that leave the table fade out (or fly onto the group they joined); cards that split
// off a group fly out of it. Every element is one fixed-size box (the card face's design size) and
// its placed width is only a scale in the transform, so a new width never lays the face out again.

export const FLIP_MS = 220
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)'

export type View = { w: number; h: number }

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Layout for the table: recomputed only when the structural signature or the viewport changes. */
export function useTableLayout(viewport: View) {
  const userFocus = useBoardUi((s) => s.focus)
  const { meId, focusId } = useForge(useShallow((s) => seatIds(s, userFocus)))
  const sig = useForge((s) => tableSignature(s, meId, focusId))
  const layout = useMemo((): LayoutResult => {
    const s = useForge.getState()
    if (!s.game || meId == null) return { placements: new Map(), regions: { ...tableFrame(viewport, false, 0) } as LayoutResult['regions'] }
    const mode = tableMode(s.combat, s.game.phase)
    return LAYOUTS[mode]({ mode, viewport, meId, focusId, game: s.game, players: s.players, cards: s.cards, combat: s.combat, highlighted: s.highlighted, stack: s.stack, selectable: s.selectable.cardIds })
    // sig stands for everything structural in the store, so the rest is read through getState.
  }, [sig, viewport.w, viewport.h, meId, focusId])
  return { layout, meId, focusId }
}

// Test hook: how often each card element rendered.
export const renderCounts = new Map<number, number>()

function whereOf(placements: Map<number, Placement>) {
  const m = new Map<number, Placement>()
  for (const [id, p] of placements) {
    m.set(id, p)
    for (const mid of p.memberIds ?? []) m.set(mid, p)
  }
  return m
}

// Placements as last rendered, where each id was drawn (members at their group's element), and
// the cards still animating off the table.
type Track = { placements: Map<number, Placement>; where: Map<number, Placement>; prevWhere: Map<number, Placement> | null; ghosts: Map<number, Placement> }

export function CardLayer({ layout }: { layout: LayoutResult }) {
  const { placements } = layout
  const [t, setT] = useState<Track>(() => ({ placements, where: whereOf(placements), prevWhere: null, ghosts: new Map() }))
  let track = t
  if (t.placements !== placements) {
    // Derived during render, so a card that leaves keeps its element without a frame's gap.
    const where = whereOf(placements)
    const ghosts = new Map([...t.ghosts].filter(([id]) => !placements.has(id)))
    for (const [id, p] of t.placements) {
      if (placements.has(id)) continue
      const head = where.get(id) // it joined a group: fly onto it; else fade where it was
      ghosts.set(id, head ? { ...head, count: undefined, memberIds: undefined, z: head.z - 1, opacity: 0 } : { ...p, count: undefined, memberIds: undefined, opacity: 0, scale: 0.9 })
    }
    track = { placements, where, prevWhere: t.where, ghosts }
    setT(track)
  }

  useEffect(() => {
    const done = () => useBoardUi.setState((s) => ({ settled: s.settled + 1 }))
    if (!track.prevWhere) return done()
    // Counted from the first frame, when the animations start: a slow commit frame must not cut them short.
    let timer = 0
    const raf = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        setT((s) => (s.ghosts.size ? { ...s, ghosts: new Map() } : s))
        done()
      }, FLIP_MS + 30)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [track.placements, track.prevWhere])

  const items = useMemo(() => {
    const all: [number, Placement, boolean][] = [...track.placements].map(([id, p]) => [id, p, false])
    for (const [id, p] of track.ghosts) all.push([id, p, true])
    return all.sort((a, b) => a[0] - b[0]) // stable DOM order: moving nodes would restart animations
  }, [track.placements, track.ghosts])

  const prev = track.prevWhere
  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-card-layer>
      {items.map(([id, p, ghost]) => (
        <CardView key={id} id={id} p={p} ghost={ghost} from={prev ? (prev.get(id) ?? enterFrom(p)) : undefined} />
      ))}
      <GrownCard />
    </div>
  )
}

const enterFrom = (p: Placement): Placement => ({ ...p, opacity: 0, scale: 0.92 })

type Box = { x: number; y: number; w: number; o: number }
const boxOf = (p: Placement): Box => ({ x: p.x, y: p.y, w: p.w * (p.scale ?? 1), o: p.opacity ?? 1 })
const lerp = (a: Box, b: Box, k: number): Box => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, o: a.o + (b.o - a.o) * k })
const tf = (b: Box) => `translate(${b.x}px, ${b.y}px) scale(${b.w / DESIGN_W})`
const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.o === b.o

function useFlip(ref: RefObject<HTMLDivElement | null>, p: Placement, from: Placement | undefined, onMove: () => void) {
  const prev = useRef<Box | null>(from ? boxOf(from) : null)
  const run = useRef<{ a: Animation; from: Box; to: Box } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const before = prev.current
    const to = boxOf(p)
    prev.current = to
    if (!el || !before || sameBox(before, to)) return
    onMove()
    if (!el.animate || reducedMotion()) return
    let start = before
    const r = run.current
    if (r) {
      // Interrupted mid-flight: start from where it is now, computed from the animation's own progress.
      const k = r.a.playState === 'running' ? r.a.effect?.getComputedTiming().progress : null
      if (k != null) start = lerp(r.from, r.to, k)
      r.a.cancel()
    }
    const a = el.animate(
      [
        { transform: tf(start), opacity: start.o },
        { transform: tf(to), opacity: to.o },
      ],
      { duration: FLIP_MS, easing: EASE },
    )
    run.current = { a, from: start, to }
    a.onfinish = () => {
      if (run.current?.a === a) run.current = null
    }
  }, [ref, p])
}

type CardViewProps = { id: number; p: Placement; ghost: boolean; from?: Placement }

const sameIds = (a?: number[], b?: number[]) => a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]))
function samePlacement(a: Placement, b: Placement) {
  for (const k of Object.keys(a) as (keyof Placement)[]) if (k !== 'memberIds' && a[k] !== b[k]) return false
  return Object.keys(a).length === Object.keys(b).length && sameIds(a.memberIds, b.memberIds)
}
const sameProps = (a: CardViewProps, b: CardViewProps) => a.id === b.id && a.ghost === b.ghost && samePlacement(a.p, b.p) // `from` only matters on mount

// Tapped cards are drawn smaller so the quarter-turned face fits the untapped footprint.
const TAPPED_W = Math.round((DESIGN_W * 63) / 88)

const CardView = memo(function CardView({ id, p, ghost, from }: CardViewProps) {
  if (import.meta.env.DEV) renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1)
  const faceId = p.faceId ?? id
  const live = useForge((s) => s.cards[faceId])
  const last = useRef<CardDto | undefined>(live)
  if (live) last.current = live
  const card = live ?? last.current
  const ids = useMemo(() => (p.memberIds ? [id, ...p.memberIds] : [id]), [id, p.memberIds])
  const peek = usePeek({ kind: 'card', id: faceId })
  const ref = useRef<HTMLDivElement>(null)
  // A hovered card that moves away (say, into an attack lane) stops being hovered: its grown copy and peek don't stay behind.
  useFlip(ref, p, from, () => {
    const key = peekKey({ kind: 'card', id: faceId })
    if (usePopover.getState().peek?.key === key) peekTimer.leave(key)
  })
  const [pileOpen, setPileOpen] = useState(false)
  const pileTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(pileTimer.current), [])
  if (!card) return null

  const active = !ghost && p.kind !== 'zone'
  const onClick = (e: MouseEvent) => clickCards(e, p.kind === 'field' ? ids : [id])
  const pileHover = (open: boolean) => {
    if (!p.pile) return
    window.clearTimeout(pileTimer.current)
    pileTimer.current = window.setTimeout(() => setPileOpen(open), open ? 220 : 160)
  }
  const b = boxOf(p)
  return (
    <div
      ref={ref}
      data-entity={`card:${id}`}
      data-ids={ids.join(' ')}
      tabIndex={active ? 0 : undefined}
      className={`absolute left-0 top-0 outline-none ${active ? 'pointer-events-auto cursor-pointer' : ''}`}
      style={{ width: DESIGN_W, height: DESIGN_H, transform: tf(b), transformOrigin: '0 0', opacity: b.o, zIndex: pileOpen ? 5000 : p.z }}
      {...(active ? peek : {})}
      onPointerEnter={(e) => {
        if (active) peek.onPointerEnter(e)
        pileHover(true)
      }}
      onPointerLeave={() => {
        if (active) peek.onPointerLeave()
        pileHover(false)
      }}
      onClick={active ? onClick : undefined}
      onContextMenu={active ? onClick : undefined}
    >
      <div className="absolute inset-0" style={{ opacity: card.phasedOut ? 0.32 : undefined }}>
        {p.kind === 'field' || p.kind === 'attach' ? (
          <FieldFace ids={ids} card={card} tapped={p.rot === 90} count={p.count ?? 1} words={p.w >= DESIGN_W * 0.66} label={p.label} />
        ) : p.kind === 'hand' ? (
          <div className="absolute inset-0 origin-bottom transition-[translate] duration-150 hover:-translate-y-5" style={{ transform: `rotate(${p.rot}deg)` }}>
            <FieldFace ids={ids} card={card} tapped={false} count={1} words />
          </div>
        ) : (
          <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 8 }}>
            <CardImage card={card} width={DESIGN_W} bare />
          </div>
        )}
      </div>
      {pileOpen && <PileGroups ids={ids} w={p.w} up={p.edge === 'bottom'} onEnter={() => pileHover(true)} />}
    </div>
  )
}, sameProps)

function FieldFace({ ids, card, tapped, count, words, label, width = DESIGN_W }: { ids: number[]; card: CardDto; tapped: boolean; count: number; words: boolean; label?: string; width?: number }) {
  const look = useCardLook(ids, card)
  const w = tapped ? (width * TAPPED_W) / DESIGN_W : width
  const off = tapped ? { left: (width - w) / 2, top: ((width - w) * DESIGN_H) / DESIGN_W / 2 } : { left: 0, top: 0 }
  return (
    <div style={{ position: 'absolute', ...off }}>
      <CardFrame card={card} width={w} rotate={tapped} highlight={look.highlight} dim={look.dim} verdict={look.verdict} choosingTargets={look.choosingTargets} base={look.base} count={count} words={words} mini={!words} />
      {card.heldExileIds.length > 0 && <HeldExile ids={card.heldExileIds} />}
      {label && (
        <span className="lk-title" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', whiteSpace: 'nowrap', padding: '0 10px', borderRadius: 999, background: 'var(--lk-chip)', boxShadow: '0 0 0 1px var(--lk-metal-line)', color: 'var(--lk-parchment)', fontWeight: 700, fontSize: 15, lineHeight: '26px' }}>
          {label}
        </span>
      )}
    </div>
  )
}

/** A land pile with more than one kind of copy (some tapped): its groups, shown on hover. */
function PileGroups({ ids, w, up, onEnter }: { ids: number[]; w: number; up: boolean; onEnter: () => void }) {
  const cards = useForge(useShallow((s) => ids.map((id) => s.cards[id])))
  const combat = useForge((s) => s.combat)
  const highlighted = useForge((s) => s.highlighted)
  const pile = groupBattlefield(cards.filter((c): c is CardDto => !!c), combat, { highlighted }).lands[0]
  if (!pile) return null
  // Drawn inside the scaled element, so sizes are in design units.
  const k = DESIGN_W / Math.max(w, 1)
  const ew = Math.max(DESIGN_W, 62 * k)
  const estep = ew * 1.16
  const panelH = (ew * DESIGN_H) / DESIGN_W + 34 * k
  return (
    <div
      className="bf-pop lk-text absolute z-40"
      style={{ left: -10 * k, top: up ? -panelH - 6 * k : DESIGN_H + 14 * k, width: (pile.groups.length - 1) * estep + ew + 20 * k, height: panelH, borderRadius: 14 * k, background: 'var(--lk-panel)', boxShadow: `0 0 0 ${k}px var(--lk-metal-line), 0 16px 34px rgb(0 0 0 / .65)` }}
      onPointerEnter={onEnter}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ padding: `${4 * k}px ${10 * k}px 0`, fontSize: 12 * k, color: 'var(--lk-parchment-dim)' }}>
        {pile.name} ×{pile.ids.length}
        {pile.tapped ? ` · ${pile.tapped} tapped` : ''}
      </div>
      <div className="relative" style={{ marginTop: 4 * k }}>
        {pile.groups.map((g, i) => (
          <div key={g.key} className="absolute top-0" style={{ left: 10 * k + i * estep }} onClick={(e) => clickCards(e, g.ids)} onContextMenu={(e) => clickCards(e, g.ids)}>
            <FieldFace ids={g.ids} card={g.top} tapped={g.top.tapped} count={g.ids.length} words={false} width={ew} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * D-09: the hovered card, grown in place over its neighbours, at the same rect the popover system
 * places the peek answer beside. A pointer-transparent copy, so the real element keeps its size and hit area.
 */
export function GrownCard() {
  const grownId = usePopover((s) => s.grownCardId)
  const anchor = usePopover((s) => (s.grownCardId != null ? s.peek?.anchor : undefined))
  const card = useForge((s) => (grownId != null ? s.cards[grownId] : undefined))
  const ref = useRef<HTMLDivElement>(null)
  const r = anchor ? grownRect(anchor, { w: window.innerWidth, h: window.innerHeight }) : null
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor || !r || !el.animate || reducedMotion()) return
    el.animate([{ transform: `translate(${anchor.x - r.x}px, ${anchor.y - r.y}px) scale(${anchor.w / r.w})` }, { transform: 'none' }], { duration: 120, easing: EASE })
  }, [grownId, anchor]) // animate only when a new card grows
  if (!card || !anchor || !r || r.w <= anchor.w) return null
  return createPortal(
    <div
      ref={ref}
      data-grown={card.id}
      className="pointer-events-none fixed rounded-[10px] shadow-2xl shadow-black/70"
      style={{ left: r.x, top: r.y, width: r.w, transformOrigin: '0 0', zIndex: 79 }}
    >
      <CardImage card={card} width={r.w} />
    </div>,
    document.body,
  )
}
