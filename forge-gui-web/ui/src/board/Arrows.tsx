import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import type { EntityRef } from '../protocol'
import { useForge } from '../store'
import { useBoardUi } from './uiStore'

type Arrow = { key: string; d: string; kind: 'target' | 'attack' | 'block'; dim: boolean; emph: boolean }

const COLORS = { target: 'var(--color-accent)', attack: 'var(--color-danger)', block: '#d4dde8' }

function find(root: HTMLElement, ref: EntityRef | string): Element | null {
  if (typeof ref === 'string') return root.querySelector(`[data-entity="${ref}"]`)
  if (ref.kind === 'player') return root.querySelector(`[data-entity="player:${ref.id}"]`)
  return root.querySelector(`[data-entity="card:${ref.id}"]`) ?? root.querySelector(`[data-ids~="${ref.id}"]`)
}

type R = { x: number; y: number; w: number; h: number }

// Where the segment from the centre of r towards (tx,ty) leaves r (plus a small margin).
function edgePoint(r: R, tx: number, ty: number, m: number) {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const sx = dx ? (r.w / 2 + m) / Math.abs(dx) : Infinity
  const sy = dy ? (r.h / 2 + m) / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy, 1)
  return { x: cx + dx * s, y: cy + dy * s }
}

function curve(a: R, b: R, bend: number) {
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const p0 = edgePoint(a, bc.x, bc.y, 2)
  const p1 = edgePoint(b, ac.x, ac.y, 6)
  const mx = (p0.x + p1.x) / 2
  const my = (p0.y + p1.y) / 2
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const nx = -(p1.y - p0.y) / (len || 1)
  const ny = (p1.x - p0.x) / (len || 1)
  const k = Math.min(80, len * bend)
  return `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} Q${(mx + nx * k).toFixed(1)},${(my + ny * k).toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`
}

/** SVG layer over the whole table: stack targets and combat. Elements are found by data attributes. */
export function Arrows({ rootRef, layoutVersion }: { rootRef: RefObject<HTMLDivElement | null>; layoutVersion: unknown }) {
  const stack = useForge((s) => s.stack)
  const combat = useForge((s) => s.combat)
  const cards = useForge((s) => s.cards)
  const hs = useBoardUi((s) => s.hoverStackId)
  const focus = useBoardUi((s) => s.focus)
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let t: number | undefined
    const bump = () => {
      setTick((n) => n + 1)
      window.clearTimeout(t)
      t = window.setTimeout(() => setTick((n) => n + 1), 220) // after tile transitions settle
    }
    const ro = new ResizeObserver(bump)
    ro.observe(root)
    // Tiles slide with CSS transitions; re-measure once they land.
    let raf = 0
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== 'transform') return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setTick((n) => n + 1))
    }
    root.addEventListener('transitionend', onEnd)
    return () => {
      ro.disconnect()
      window.clearTimeout(t)
      cancelAnimationFrame(raf)
      root.removeEventListener('transitionend', onEnd)
    }
  }, [rootRef])

  useEffect(() => {
    const t = window.setTimeout(() => setTick((n) => n + 1), 220)
    return () => window.clearTimeout(t)
  }, [stack, combat, cards, focus, layoutVersion])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const base = root.getBoundingClientRect()
    const rect = (el: Element): R => {
      const r = el.getBoundingClientRect()
      return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }
    }
    const out: Arrow[] = []
    const seen = new Set<string>()
    const add = (from: Element | null, to: Element | null, kind: Arrow['kind'], dim: boolean, emph: boolean, bend: number) => {
      if (!from || !to || from === to) return
      const key = `${kind}:${(from as HTMLElement).dataset.ids ?? (from as HTMLElement).dataset.entity}>${(to as HTMLElement).dataset.ids ?? (to as HTMLElement).dataset.entity}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ key, d: curve(rect(from), rect(to), bend), kind, dim, emph })
    }
    for (const item of stack) {
      const from = find(root, `stack:${item.id}`)
      for (const t of item.targets) add(from, find(root, t), 'target', hs != null && hs !== item.id, hs === item.id, 0.22)
    }
    for (const band of combat?.bands ?? []) {
      const attackers = band.attackerIds.map((id) => find(root, { kind: 'card', id }))
      if (band.defender) {
        const def = find(root, band.defender)
        for (const a of attackers) add(a, def, 'attack', hs != null, false, 0.12)
      }
      for (const b of new Set([...band.blockerIds, ...band.plannedBlockerIds])) {
        for (const a of attackers) add(find(root, { kind: 'card', id: b }), a, 'block', hs != null, false, 0)
      }
    }
    setArrows((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out))
  }, [rootRef, stack, combat, cards, hs, tick, layoutVersion])

  if (!arrows.length) return null
  return (
    <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
      <defs>
        {(['target', 'attack', 'block'] as const).map((k) => (
          <marker key={k} id={`ah-${k}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={COLORS[k]} />
          </marker>
        ))}
      </defs>
      {arrows.map((a) => (
        <g key={a.key} style={{ opacity: a.dim ? 0.18 : 1, transition: 'opacity 150ms' }}>
          <path d={a.d} fill="none" stroke="rgb(0 0 0 / 0.55)" strokeWidth={a.emph ? 7 : 5.5} strokeLinecap="round" />
          <path
            d={a.d}
            fill="none"
            stroke={COLORS[a.kind]}
            strokeWidth={a.emph ? 4 : a.kind === 'block' ? 2.5 : 3}
            strokeLinecap="round"
            strokeDasharray={a.kind === 'block' ? '1 6' : undefined}
            markerEnd={`url(#ah-${a.kind})`}
          />
        </g>
      ))}
    </svg>
  )
}
