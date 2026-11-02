import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { goBack, inLobby } from '../discord'
import { send } from '../net'
import { useBoardUi } from '../board/uiStore'
import { stepWords } from '../look/phase'
import { MoreTime } from '../board/Callouts'
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

/** What the engine is asking: the prompt, or who we're waiting for. */
function usePrompt() {
  const message = useForge((s) => s.prompt?.message)
  const stackTop = useForge((s) => (s.stack[0]?.sourceCardId != null ? s.cards[s.stack[0].sourceCardId]?.name : undefined) ?? s.stack[0]?.text)
  const waiting = useForge((s) => {
    const g = s.game
    return g?.priorityPlayerId != null && !g.localPlayerIds.includes(g.priorityPlayerId) ? (s.players[g.priorityPlayerId]?.name ?? 'opponent') : null
  })
  const yours = useForge((s) => !!(s.buttons?.ok.enabled || s.buttons?.cancel.enabled || s.selectable.cardIds.size || s.selectable.playerIds?.size))
  const asked = promptText(message, stackTop)
  // Not your move unless something is yours to press or pick; the engine can hold your priority while an AI acts.
  return { text: asked || (waiting ? `Waiting for ${waiting}…` : ''), waiting: !yours }
}

/**
 * The current action, in large type above OK and Cancel: what the engine wants from you, or who it is
 * waiting on. Gold while the decision is yours; it fades in again whenever the question changes.
 */
/** Whole seconds until the server passes priority for you, ticking; null when it isn't timing you. */
function useRespondCountdown() {
  const respondBy = useForge((s) => s.respondBy)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (respondBy == null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [respondBy])
  return respondBy == null ? null : Math.max(0, Math.ceil((respondBy - now) / 1000))
}

export function PromptHeadline() {
  const { text, waiting } = usePrompt()
  const phase = useForge((s) => s.game?.phase ?? null)
  const left = useRespondCountdown()
  if (!text) return null
  const step = stepWords(phase)
  return (
    <div
      key={text}
      className="bf-pop lk-text"
      style={{
        position: 'relative', padding: '9px 12px 10px 15px', borderRadius: 4, color: 'var(--lk-parchment)',
        background: waiting ? 'var(--lk-panel)' : 'linear-gradient(rgb(245 213 138 / .13), rgb(245 213 138 / .04)), var(--lk-panel)',
        boxShadow: waiting ? '0 0 0 1px var(--lk-metal-line)' : '0 0 0 1px var(--lk-gold-soft), 0 0 22px rgb(245 213 138 / .14)',
      }}
    >
      <span style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: waiting ? 'var(--lk-parchment-mute)' : 'var(--lk-gold)' }} />
      <div className="lk-label" style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: waiting ? 'var(--lk-parchment-dim)' : 'var(--lk-gold)' }}>
        <span style={{ whiteSpace: 'nowrap' }}>{waiting ? 'Waiting' : 'Your move'}</span>
        {step && <span style={{ fontWeight: 500, letterSpacing: '0.04em', color: 'var(--lk-parchment-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{step}</span>}
        {left != null && !waiting && (
          <span title="The server passes priority for you when this runs out" style={{ marginLeft: 'auto', whiteSpace: 'nowrap', color: left <= 3 ? 'var(--lk-danger, #e0695c)' : 'var(--lk-parchment-dim)', fontVariantNumeric: 'tabular-nums' }}>
            Passing in {left}s
          </span>
        )}
        {left != null && !waiting && <MoreTime />}
      </div>
      <div
        className="lk-title"
        title={text}
        style={{ marginTop: 3, fontSize: waiting ? 17 : 20, fontWeight: 700, lineHeight: 1.22, color: waiting ? 'var(--lk-parchment-dim)' : 'var(--lk-parchment)', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      >
        {text}
      </div>
    </div>
  )
}

export const plateButton = (primary: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', minHeight: primary ? 40 : 34, padding: '0 12px', borderRadius: 3, cursor: 'pointer',
  fontFamily: 'var(--lk-font-title)', fontWeight: 700, fontSize: 15, letterSpacing: '0.03em',
  color: primary ? '#2c261c' : 'var(--lk-parchment)',
  background: primary ? '#efe4cc' : 'transparent',
  border: primary ? '1px solid #b7ab93' : '1px solid rgb(239 228 204 / .4)',
  boxShadow: 'none',
})

// A click or key aimed at the buttons a moment ago must not answer the question that just replaced them: after
// the buttons or the prompt change, they wait this long before they take input (a bar fills meanwhile).
const SETTLE_MS = 450
let settledAt = 0
const settled = () => Date.now() >= settledAt

/** The control panel: the engine's OK and Cancel, held in two fixed slots. Space/Enter, Esc, Z. */
export function PromptBar() {
  const buttons = useForge((s) => s.buttons)
  const notices = useForge((s) => s.notices)
  const prompt = useForge((s) => s.prompt?.message ?? '')
  const change = `${prompt}|${buttons?.ok.label}|${buttons?.ok.enabled}|${buttons?.cancel.label}|${buttons?.cancel.enabled}`
  const [settling, setSettling] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    settledAt = Date.now() + SETTLE_MS
    setSettling(true)
    const t = setTimeout(() => setSettling(false), SETTLE_MS)
    return () => clearTimeout(t)
  }, [change])

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
  const spectating = useForge((s) => !!s.game && s.game.localPlayerIds.length === 0)
  const backUrl = useForge((s) => s.returnUrl)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = useForge.getState()
      if (s.ask || s.gameOver || isTyping(e.target) || e.altKey || e.metaKey) return
      const b = s.buttons
      if ((e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') && !settled()) {
        e.preventDefault() // the buttons just changed: this key was meant for the old ones
        return
      }
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

  if (spectating && (backUrl || inLobby)) {
    return (
      <div className="lk-text" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6, width: '100%', height: '100%' }}>
        <div className="lk-label" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--lk-parchment-mute)', textAlign: 'center' }}>Spectating</div>
        <a
          href={backUrl ?? undefined}
          onClick={(e) => { if (inLobby) { e.preventDefault(); goBack(backUrl) } }}
          style={{ ...plateButton(false), textDecoration: 'none' }}
        >
          {inLobby ? 'Back to the lobby' : 'Back to the tracker'}
        </a>
      </div>
    )
  }

  // Both slots stay, so OK does not jump when End Turn appears or combat opens.
  return (
    <div ref={root} key={shake} className={`lk-text ${shake ? 'shell-shake' : ''}`} style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, width: '100%', height: '100%' }}>
      {settling && <span key={change} aria-hidden className="settle-bar" style={{ position: 'absolute', left: 0, right: 0, top: -6, height: 2, borderRadius: 1, background: 'var(--lk-gold)', transformOrigin: 'left', animation: `settle ${SETTLE_MS}ms linear forwards` }} />}
      {showCancel ? (
        <button type="button" disabled={!cancel.enabled} onClick={() => settled() && send({ t: 'cancel' })} style={{ ...plateButton(false), opacity: cancel.enabled ? (settling ? 0.6 : 1) : 0.4, cursor: cancel.enabled ? 'pointer' : 'default' }}>
          {cancel.label || 'Cancel'}
          {cancel.enabled && <span style={{ fontWeight: 500, opacity: 0.55 }}>Esc</span>}
        </button>
      ) : <div style={{ minHeight: 34 }} />}
      {showOk ? (
        <button type="button" disabled={!ok.enabled} onClick={() => settled() && send({ t: 'ok' })} style={{ ...plateButton(true), opacity: ok.enabled ? (settling ? 0.6 : 1) : 0.4, cursor: ok.enabled ? 'pointer' : 'default' }}>
          {ok.label || 'OK'}
          {ok.enabled && <span style={{ fontWeight: 500, opacity: 0.5 }}>Space</span>}
        </button>
      ) : <div style={{ minHeight: 40 }} />}
    </div>
  )
}
