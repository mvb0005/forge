import { useEffect, useRef } from 'react'
import { useForge } from '../store'

/** The right-hand column: the game log. (Hovered cards now grow in place, D-09.) */
export function SidePanel() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 border-l border-line bg-panel/60 p-3">
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
  if (!log?.length) return <div className="flex-1" />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 mt-1 text-[10px] font-bold uppercase tracking-wider text-ink-dim">Log</div>
      <div ref={ref} className="bf-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 text-[11px] leading-snug text-ink-dim">
        {log.slice(-60).map((l, i) => (
          <div key={i} className={l.type.toLowerCase().includes('combat') || l.type.toLowerCase().includes('damage') ? 'text-ink' : ''}>
            {l.message}
          </div>
        ))}
      </div>
    </div>
  )
}
