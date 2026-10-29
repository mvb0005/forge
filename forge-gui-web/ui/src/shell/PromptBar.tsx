import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { send } from '../net'
import { useBoardUi } from '../board/uiStore'
import { useForge } from '../store'

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)
}

// Forge's pass-priority prompt is a status dump ("Priority: You / Turn: 8 / ... / Stack: Empty"); say what it means instead.
// The engine asks the commander question (CR 903.9a) in the rule's own words; say it as a question.
const COMMAND_ZONE = /^(.+?): If a commander is in a graveyard or in exile .* its owner may put it into the command zone\.?$/s

function promptText(message: string | undefined, stackTop: string | undefined) {
  const cmd = message?.match(COMMAND_ZONE)
  if (cmd) return `Move ${cmd[1]} to the command zone?`
  if (!message?.startsWith('Priority:')) return message
  return stackTop ? `Respond to ${stackTop}, or pass to let it resolve` : 'Play a card or ability, or pass'
}

/** What the engine is asking, for the type line: the prompt, or who we're waiting for. */
export function usePromptHint() {
  const message = useForge((s) => s.prompt?.message)
  const stackTop = useForge((s) => (s.stack[0]?.sourceCardId != null ? s.cards[s.stack[0].sourceCardId]?.name : undefined) ?? s.stack[0]?.text)
  const waiting = useForge((s) => {
    const g = s.game
    return g?.priorityPlayerId != null && !g.localPlayerIds.includes(g.priorityPlayerId) ? (s.players[g.priorityPlayerId]?.name ?? 'opponent') : null
  })
  return promptText(message, stackTop) || (waiting ? `Waiting for ${waiting}…` : '')
}

export const plateButton = (primary: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', minHeight: primary ? 40 : 34, padding: '0 12px', borderRadius: 3, cursor: 'pointer',
  fontFamily: 'var(--lk-font-title)', fontWeight: 700, fontSize: 15, letterSpacing: '0.03em',
  color: primary ? '#2c261c' : 'var(--lk-parchment)',
  background: primary ? '#efe4cc' : 'transparent',
  border: primary ? '1px solid #b7ab93' : '1px solid rgb(239 228 204 / .4)',
  boxShadow: 'none',
})

/** The control panel: the engine's OK and Cancel, held in two fixed slots. Space/Enter, Esc, Z. */
export function PromptBar() {
  const buttons = useForge((s) => s.buttons)
  const notices = useForge((s) => s.notices)

  // Shake when a new flash notice arrives (the player clicked something invalid).
  const [shake, setShake] = useState(0)
  const lastFlash = useRef(0)
  useEffect(() => {
    const f = notices.findLast((n) => n.level === 'flash')
    if (f && f.id > lastFlash.current) {
      lastFlash.current = f.id
      setShake((k) => k + 1)
    }
  }, [notices])

  const root = useRef<HTMLDivElement>(null)
  const ok = buttons?.ok
  const cancel = buttons?.cancel

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = useForge.getState()
      if (s.ask || s.gameOver || isTyping(e.target) || e.altKey || e.metaKey) return
      const b = s.buttons
      if ((e.key === ' ' || e.key === 'Enter') && !e.ctrlKey) {
        if (e.target instanceof Node && root.current?.contains(e.target)) return // the plate's own focused button handles it
        if (b?.ok.enabled) {
          e.preventDefault()
          send({ t: 'ok' })
        }
      } else if (e.key === 'Escape') {
        if (b?.cancel.enabled && !useBoardUi.getState().zoneView) {
          e.preventDefault()
          send({ t: 'cancel' })
        }
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        send({ t: 'undo' })
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const showOk = ok && (ok.enabled || ok.label)
  const showCancel = cancel && (cancel.enabled || cancel.label)

  // Both slots stay, so OK does not jump when End Turn appears or combat opens.
  return (
    <div ref={root} key={shake} className={`lk-text ${shake ? 'shell-shake' : ''}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, width: '100%', height: '100%' }}>
      {showCancel ? (
        <button type="button" disabled={!cancel.enabled} onClick={() => send({ t: 'cancel' })} style={{ ...plateButton(false), opacity: cancel.enabled ? 1 : 0.4, cursor: cancel.enabled ? 'pointer' : 'default' }}>
          {cancel.label || 'Cancel'}
          {cancel.enabled && <span style={{ fontWeight: 500, opacity: 0.55 }}>Esc</span>}
        </button>
      ) : <div style={{ minHeight: 34 }} />}
      {showOk ? (
        <button type="button" disabled={!ok.enabled} onClick={() => send({ t: 'ok' })} style={{ ...plateButton(true), opacity: ok.enabled ? 1 : 0.4, cursor: ok.enabled ? 'pointer' : 'default' }}>
          {ok.label || 'OK'}
          {ok.enabled && <span style={{ fontWeight: 500, opacity: 0.5 }}>Space</span>}
        </button>
      ) : <div style={{ minHeight: 40 }} />}
    </div>
  )
}
