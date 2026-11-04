import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { goBack, inLobby } from '../discord'
import { send } from '../net'
import { useBoardUi } from '../board/uiStore'
import { stepWords } from '../look/phase'
import { MoreTime } from '../board/Callouts'
import { PassAhead } from './PassAhead'
import { PassMenu } from './PassMenu'
import { usePrompt, useRespondCountdown } from '../board/situation'
import { useForge } from '../store'

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)
}

/** The current action, in large type above OK and Cancel. Gold while the decision is yours. */
export function PromptHeadline() {
  const asked = usePrompt()
  const passing = useForge((s) => s.autopass.yield?.label ?? null)
  const stopped = useForge((s) => s.autopass.stopped)
  // While a yield runs the server passes for you: say what you're waiting for, not the engine's yield text.
  const text = passing ?? asked.text
  const waiting = passing != null || asked.waiting
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
        <span style={{ whiteSpace: 'nowrap' }}>{passing ? 'Passing' : waiting ? 'Waiting' : 'Your move'}</span>
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
      {stopped && !passing && (
        <div className="lk-text" style={{ marginTop: 4, fontSize: 12.5, color: 'var(--lk-ember-text, #e8a15c)' }}>Stopped passing: {stopped}</div>
      )}
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
  const over = useForge((s) => !!s.game?.gameOver) // still true after "See the board" closes the result
  const backUrl = useForge((s) => s.returnUrl)
  const passing = useForge((s) => !!s.autopass.yield)

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
        if (s.autopass.yield && !useBoardUi.getState().zoneView) {
          e.preventDefault()
          send({ t: 'unyield' })
        } else if (b?.cancel.enabled && !useBoardUi.getState().zoneView) {
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

  if ((spectating || over) && (backUrl || inLobby)) {
    return (
      <div className="lk-text" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6, width: '100%', height: '100%' }}>
        <div className="lk-label" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--lk-parchment-mute)', textAlign: 'center' }}>{over ? 'Game over' : 'Spectating'}</div>
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
      <PassMenu />
      <PassAhead />
      {passing ? (
        <button type="button" onClick={() => send({ t: 'unyield' })} style={plateButton(false)}>
          Stop passing
          <span style={{ fontWeight: 500, opacity: 0.55 }}>Esc</span>
        </button>
      ) : showCancel ? (
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
