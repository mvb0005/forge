import { useEffect, useRef } from 'react'
import { useForge } from '../store'

/** The right-hand column: the game log. (Hovered cards now grow in place, D-09.) */
export function SidePanel() {
  return (
    <div className="lk-text flex h-full min-h-0 flex-col gap-2 px-4 py-4" style={{ background: 'linear-gradient(90deg, #120e0a, #0d0a07)', boxShadow: 'inset 1px 0 0 var(--lk-metal-line)', color: 'var(--lk-parchment)' }}>
      <GameLog />
    </div>
  )
}

function GameLog() {
  const log = useForge((s) => s.game?.log)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="lk-title mb-2 flex items-baseline justify-between border-b pb-2" style={{ borderColor: 'var(--lk-metal-line)' }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>Log</span>
      </div>
      <div ref={ref} className="bf-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--lk-parchment-dim)' }}>
        {(log ?? []).map((l, i) => (
          <div key={i} style={l.type.toLowerCase().includes('combat') || l.type.toLowerCase().includes('damage') ? { color: 'var(--lk-ember-light)' } : undefined}>
            {l.message}
          </div>
        ))}
      </div>
    </div>
  )
}
