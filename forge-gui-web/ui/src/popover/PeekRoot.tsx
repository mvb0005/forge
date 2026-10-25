import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PhaseName } from '../protocol'
import { useForge } from '../store'
import type { TableMode } from '../table/contract'
import { peekSections, type PeekContext, type PeekSection } from '../table/peek'
import { INSPECT_KEY, isInspectKey } from './gesture'
import { grownRect, placeBeside, placeFar, type Rect } from './place'
import './providers'
import { closeTop, togglePin, usePopover, type PeekTarget } from './store'
import { PEEK_ID } from './usePeek'

const WIDTH = { peek: 260, inspect: 340 }

const toneCls: Record<NonNullable<PeekSection['tone']>, string> = {
  info: 'text-accent',
  good: 'text-playable',
  danger: 'text-danger',
  trigger: 'text-target',
}

const modeOf = (phase: PhaseName | null): TableMode => (phase?.startsWith('COMBAT_') ? 'combat' : 'main')

// Mount once. Shows the hovered/focused peek and the pinned Inspect panel; owns Esc and the inspect key.
export function PeekRoot() {
  const peek = usePopover((s) => s.peek)
  const pinned = usePopover((s) => s.pinned)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (closeTop()) {
          e.preventDefault()
          e.stopPropagation()
        }
      } else if (isInspectKey(e) && (usePopover.getState().peek || usePopover.getState().pinned)) {
        e.preventDefault()
        togglePin()
      }
    }
    window.addEventListener('keydown', h, true) // capture: Esc must not also reach PromptBar's cancel
    return () => window.removeEventListener('keydown', h, true)
  }, [])

  return createPortal(
    <>
      {pinned && <Panel key={`pin:${pinned.key}`} target={pinned} depth="inspect" />}
      {peek && peek.key !== pinned?.key && <Panel key={peek.key} target={peek} depth="peek" />}
    </>,
    document.body,
  )
}

function Panel({ target, depth }: { target: PeekTarget; depth: 'peek' | 'inspect' }) {
  const state = useForge() // mounted only while open, so following every change is fine
  const phase = state.game?.phase ?? null
  const ctx: PeekContext = { phase, mode: modeOf(phase), state, depth }
  const sections = peekSections(target.entity, ctx)
  const ref = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<Rect | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const view = { w: window.innerWidth, h: window.innerHeight }
    const size = { w: WIDTH[depth], h: el.offsetHeight }
    const r =
      depth === 'inspect'
        ? placeFar(target.anchor, size, view)
        : placeBeside(target.entity.kind === 'card' ? grownRect(target.anchor, view) : target.anchor, size, view)
    setRect((p) => (p && p.x === r.x && p.y === r.y && p.h === r.h ? p : r))
  })

  if (!sections.length) return null
  const inspect = depth === 'inspect'
  return (
    <div
      ref={ref}
      id={inspect ? undefined : PEEK_ID}
      role={inspect ? 'dialog' : 'tooltip'}
      aria-label={inspect ? 'Inspect' : undefined}
      className={`fixed z-[80] overflow-y-auto rounded-xl border bg-panel/95 p-3 text-sm text-ink shadow-2xl backdrop-blur ${
        inspect ? 'border-accent/60' : 'pointer-events-none border-line'
      }`}
      style={{
        left: rect?.x ?? 0,
        top: rect?.y ?? 0,
        width: WIDTH[depth],
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100vh - 24px)',
        visibility: rect ? 'visible' : 'hidden',
      }}
    >
      {inspect && (
        <button
          type="button"
          onClick={() => usePopover.setState({ pinned: null })}
          className="float-right -mr-1 -mt-1 rounded px-1.5 text-ink-dim hover:bg-panel-2 hover:text-ink"
          aria-label="Close"
        >
          ×
        </button>
      )}
      <div className="space-y-2">
        {sections.map((s) => (
          <section key={s.key} className="border-t border-line/60 pt-2 first:border-t-0 first:pt-0">
            {s.title && <div className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wider ${s.tone ? toneCls[s.tone] : 'text-ink-dim'}`}>{s.title}</div>}
            {s.body}
          </section>
        ))}
      </div>
      {!inspect && <div className="mt-2 text-[10px] text-ink-dim">Press {INSPECT_KEY.toUpperCase()} to pin</div>}
    </div>
  )
}
