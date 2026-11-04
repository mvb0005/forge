import { useEffect, type RefObject } from 'react'
import { useForge } from '../store'
import type { LayoutResult, Region } from '../table/contract'
import { HAND_ARROW } from '../table/layouts'
import { useBoardUi } from './uiStore'

// A hand too big to show whole (layouts.ts) shows a window of it. Each end of the hand row says how many
// cards are past it, lit when one of them is playable; clicking it pages over, and the mouse wheel over the
// hand row scrolls.
export function HandScroll({ hand, row, rootRef }: { hand: LayoutResult['hand']; row: Region | undefined; rootRef: RefObject<HTMLDivElement | null> }) {
  const setStart = useBoardUi((s) => s.setHandStart)
  const lit = useForge((s) => {
    if (!hand) return ''
    const on = (ids: number[]) => ids.some((id) => s.playable.has(id) || s.selectable.cardIds.has(id))
    return `${on(hand.ids.slice(0, hand.start)) ? 'L' : ''}${on(hand.ids.slice(hand.start + hand.shown)) ? 'R' : ''}`
  })
  const start = hand?.start ?? 0
  const shown = hand?.shown ?? 0
  const total = hand?.ids.length ?? 0
  const top = row && hand ? row.y : 0
  const bottom = row && hand ? row.y + row.h : 0

  useEffect(() => {
    const root = rootRef.current
    if (!root || !shown) return
    const onWheel = (e: WheelEvent) => {
      const y = e.clientY - root.getBoundingClientRect().top
      if (y < top || y > bottom) return
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (!d) return
      e.preventDefault()
      const by = Math.max(1, Math.round(shown / 4))
      setStart(Math.min(total - shown, Math.max(0, start + Math.sign(d) * by)))
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [rootRef, top, bottom, start, shown, total, setStart])

  if (!hand || !row) return null
  const left = start
  const right = total - start - shown
  const page = Math.max(1, shown - 1)
  const end = (side: 'L' | 'R', n: number, to: number) => (
    <button
      type="button"
      disabled={!n}
      title={n ? `${n} more card${n === 1 ? '' : 's'} in hand` : undefined}
      onClick={() => setStart(Math.min(total - shown, Math.max(0, to)))}
      className="lk-title"
      style={{
        position: 'absolute', top: row.y + 6, height: Math.min(row.h - 12, 120), width: HAND_ARROW - 6, zIndex: 7000,
        left: side === 'L' ? row.x + 6 : row.x + row.w - HAND_ARROW,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
        borderRadius: 8, fontSize: 14, cursor: n ? 'pointer' : 'default', opacity: n ? 1 : 0.35,
        color: lit.includes(side) ? 'var(--lk-frost)' : 'var(--lk-parchment-dim)',
        background: 'var(--lk-panel)',
        border: `1px solid ${lit.includes(side) ? 'var(--lk-frost)' : 'rgb(217 205 178 / .25)'}`,
        boxShadow: lit.includes(side) ? '0 0 10px rgb(155 231 242 / .45)' : undefined,
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>{side === 'L' ? '‹' : '›'}</span>
      <span>{n}</span>
    </button>
  )
  return (
    <>
      {end('L', left, start - page)}
      {end('R', right, start + page)}
    </>
  )
}
