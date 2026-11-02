import { useEffect, useRef } from 'react'
import { send } from '../net'
import { useBoardUi } from '../board/uiStore'
import { useForge } from '../store'

const FLASH_MS = 3500
// As PromptBar's buttons: a press in the first moment after the offer appears was meant for what came before it.
const SETTLE_MS = 450
let shownAt = 0
const settled = () => Date.now() - shownAt >= SETTLE_MS

/**
 * Passing ahead (M12.1): while someone else has priority and you're still to be asked this round, pass now. It counts
 * when priority reaches you, unless anyone acts first; then the server says so (a "Pass cancelled" notice naming
 * what they did) and this points at the new stack item, as hovering it would.
 */
export function PassAhead() {
  const ahead = useForge((s) => s.ahead)
  const yours = useForge((s) => !!s.buttons?.ok.enabled)
  const notices = useForge((s) => s.notices)

  useEffect(() => {
    shownAt = Date.now()
  }, [ahead?.round, ahead?.open])

  const flashed = useRef(0)
  useEffect(() => {
    const n = notices.findLast((x) => x.stackId != null)
    if (!n || n.id <= flashed.current || n.stackId == null) return
    flashed.current = n.id
    const id = n.stackId
    useBoardUi.getState().setHoverStack(id)
    const t = setTimeout(() => {
      if (useBoardUi.getState().hoverStackId === id) useBoardUi.getState().setHoverStack(null)
    }, FLASH_MS)
    return () => clearTimeout(t)
  }, [notices])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = useForge.getState()
      const a = s.ahead
      if (e.key !== ' ' || e.repeat || s.ask || s.gameOver || s.buttons?.ok.enabled || !a?.open || a.passed) return
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName))) return
      e.preventDefault()
      if (settled()) send({ t: 'passAhead', round: a.round })
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (!ahead || yours || !(ahead.open || ahead.passed)) return null
  if (ahead.passed) {
    return (
      <div className="lk-text" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, padding: '0 10px', borderRadius: 3, border: '1px solid var(--lk-metal-line)', fontSize: 13 }}>
        <span style={{ color: 'var(--lk-parchment)' }}>Passed ahead</span>
        <span style={{ color: 'var(--lk-parchment-mute)', fontSize: 11.5, flex: 1 }}>cancelled if anyone acts first</span>
        <button type="button" onClick={() => send({ t: 'unpassAhead' })}
          style={{ border: '1px solid rgb(239 228 204 / .4)', borderRadius: 3, background: 'transparent', color: 'var(--lk-parchment)', cursor: 'pointer', fontSize: 12, padding: '2px 8px' }}>
          Undo
        </button>
      </div>
    )
  }
  return (
    <button type="button" onClick={() => settled() && send({ t: 'passAhead', round: ahead.round })}
      title="Pass now: it counts when priority reaches you, unless someone acts first"
      className="lk-title"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', minHeight: 34, padding: '0 12px', borderRadius: 3, cursor: 'pointer', fontWeight: 700, fontSize: 14, letterSpacing: '0.03em', color: 'var(--lk-parchment)', background: 'transparent', border: '1px dashed rgb(239 228 204 / .45)' }}>
      Pass ahead
      <span style={{ fontWeight: 500, opacity: 0.55 }}>Space</span>
    </button>
  )
}
