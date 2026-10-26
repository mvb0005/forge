import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { send } from '../net'
import { useBoardUi } from '../board/uiStore'
import { Icon, MARK_GLYPH } from '../look/glyphs'
import type { CardDto } from '../protocol'
import { useForge } from '../store'
import { Kbd } from './ui'

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)
}

// Forge's pass-priority prompt is a status dump ("Priority: You / Turn: 8 / ... / Stack: Empty"); say what it means instead.
function promptText(message: string | undefined, stackTop: string | undefined) {
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
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', minHeight: primary ? 54 : 40, border: 0, borderRadius: 10, cursor: 'pointer',
  fontFamily: 'var(--lk-font-title)', fontWeight: 700, fontSize: primary ? 19 : 15,
  color: primary ? 'var(--lk-on-parchment)' : 'var(--lk-parchment)',
  background: primary ? 'linear-gradient(var(--lk-metal-bright), var(--lk-metal-deep))' : 'linear-gradient(var(--lk-plate-top), var(--lk-ink-2))',
  boxShadow: primary ? '0 0 0 2px var(--lk-ink), 0 0 0 3.5px var(--lk-metal), 0 10px 20px rgb(0 0 0 / .6)' : '0 0 0 1.5px var(--lk-ink), 0 0 0 2.5px var(--lk-metal-line), 0 6px 14px rgb(0 0 0 / .5)',
})

/** The action plate: the engine's OK and Cancel, keyboard (Space/Enter, Esc, Z) and, in combat, the ledger. */
export function PromptBar() {
  const buttons = useForge((s) => s.buttons)
  const notices = useForge((s) => s.notices)
  const ledger = useForge((s) => !!s.combatAssist && !!s.combat?.bands.length)

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

  return (
    <div ref={root} key={shake} className={`lk-text ${shake ? 'shell-shake' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      {ledger && <Ledger />}
      {showOk && (
        <button type="button" disabled={!ok.enabled} onClick={() => send({ t: 'ok' })} style={{ ...plateButton(true), opacity: ok.enabled ? 1 : 0.4, cursor: ok.enabled ? 'pointer' : 'default' }}>
          {ok.label || 'OK'}
          {ok.enabled && <span style={{ opacity: 0.55 }}><Kbd>Space</Kbd></span>}
        </button>
      )}
      {showCancel && (
        <button type="button" disabled={!cancel.enabled} onClick={() => send({ t: 'cancel' })} style={{ ...plateButton(false), opacity: cancel.enabled ? 1 : 0.4, cursor: cancel.enabled ? 'pointer' : 'default' }}>
          {cancel.label || 'Cancel'}
          {cancel.enabled && <span style={{ opacity: 0.55 }}><Kbd>Esc</Kbd></span>}
        </button>
      )}
    </div>
  )
}

const NO_CARDS: Record<number, CardDto> = {}

/** What happens if blocks stand as they are, from the combat assist (the engine's own evaluator). */
function Ledger() {
  const a = useForge((s) => s.combatAssist)!
  const bands = useForge((s) => s.combat?.bands ?? [])
  const cards = useForge((s) => (s.combat?.bands.length ? s.cards : NO_CARDS))
  const players = useForge((s) => s.players)
  const meId = useForge((s) => s.game?.localPlayerIds[0])
  const phase = useForge((s) => s.game?.phase)
  const before = phase === 'COMBAT_BEGIN' || phase === 'COMBAT_DECLARE_ATTACKERS'
  const name = (id: number) => cards[id]?.name ?? '?'
  const rows = bands.filter((b) => b.attackerIds.length).map((b) => {
    const atk = b.attackerIds.map(name).join(', ')
    const blk = [...new Set([...b.blockerIds, ...b.plannedBlockerIds])]
    const died = [...b.attackerIds, ...blk].filter((id) => [...a.attackers, ...a.blockers].some((x) => x.id === id && x.dies)).map(name)
    const dmg = b.attackerIds.reduce((n, id) => n + (a.attackers.find((x) => x.id === id)?.damage ?? 0), 0)
    const text = blk.length ? `${atk} blocked by ${blk.map(name).join(', ')}` : before ? `${atk} attacking` : `${atk} unblocked`
    return { key: b.attackerIds.join(','), text, died, dmg }
  })
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 14, maxHeight: 380, overflowY: 'auto',
      background: 'linear-gradient(#211a13, var(--lk-ink-2))', boxShadow: '0 0 0 2px var(--lk-ink), 0 0 0 3.5px var(--lk-metal), 0 16px 34px rgb(0 0 0 / .65)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, borderBottom: '1px solid var(--lk-metal-line)', paddingBottom: 8 }}>
        <span className="lk-title" style={{ fontWeight: 700, fontSize: 20 }}>Combat</span>
        <span className="lk-label" style={{ fontSize: 13, color: 'var(--lk-parchment-dim)' }}>{before ? 'If unblocked' : 'As blocks stand'}</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, lineHeight: 1.3 }}>
          <span style={{ marginTop: 2 }}><Icon g={r.died.length ? MARK_GLYPH.dies : MARK_GLYPH.trigger} size={15} color={r.died.length ? 'var(--lk-ember-text)' : 'var(--lk-parchment-mute)'} /></span>
          <span style={{ flex: 1 }}>
            {r.text}
            {r.died.length > 0 && <span style={{ color: 'var(--lk-ember-light)' }}>: {r.died.join(', ')} {r.died.length > 1 ? 'die' : 'dies'}</span>}
          </span>
          {r.dmg > 0 && <b className="lk-title" style={{ color: 'var(--lk-ember-light)' }}>−{r.dmg}</b>}
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--lk-metal-line)', paddingTop: 10 }}>
        {a.players.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 15 }}>{p.id === meId ? 'You' : (players[p.id]?.name ?? '?')}</span>
            <span className="lk-title" style={{ fontWeight: 900, fontSize: 24, whiteSpace: 'nowrap' }}>
              {players[p.id]?.life} → <span style={{ color: p.lifeAfter < (players[p.id]?.life ?? 0) ? 'var(--lk-ember-light)' : 'var(--lk-parchment)' }}>{p.lifeAfter}</span>
              {p.lethal && <span className="lk-label" style={{ marginLeft: 8, fontSize: 13, color: 'var(--lk-ember-text)' }}>Lethal</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
