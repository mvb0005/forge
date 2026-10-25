import { useEffect, useRef, useState } from 'react'
import { send } from '../net'
import type { PhaseName } from '../protocol'
import { useBoardUi } from '../board/uiStore'
import { useForge } from '../store'
import { Kbd } from './ui'

const phaseLabel: Record<PhaseName, string> = {
  UNTAP: 'untap',
  UPKEEP: 'upkeep',
  DRAW: 'draw',
  MAIN1: 'main 1',
  COMBAT_BEGIN: 'combat',
  COMBAT_DECLARE_ATTACKERS: 'attackers',
  COMBAT_DECLARE_BLOCKERS: 'blockers',
  COMBAT_FIRST_STRIKE_DAMAGE: 'first strike',
  COMBAT_DAMAGE: 'combat damage',
  COMBAT_END: 'end of combat',
  MAIN2: 'main 2',
  END_OF_TURN: 'end step',
  CLEANUP: 'cleanup',
}

function usePhaseText() {
  const game = useForge((s) => s.game)
  const players = useForge((s) => s.players)
  if (!game) return { text: '', mine: false, waiting: null as string | null }
  const local = game.localPlayerIds
  const mine = game.activePlayerId != null && local.includes(game.activePlayerId)
  const opponents = Object.values(players).filter((p) => !local.includes(p.id))
  const owner = mine ? 'Your' : opponents.length > 1 && game.activePlayerId != null ? `${players[game.activePlayerId]?.name ?? 'Opponent'}'s` : "Opponent's"
  const phase = game.phase ? phaseLabel[game.phase] : ''
  const waiting = game.priorityPlayerId != null && !local.includes(game.priorityPlayerId) ? players[game.priorityPlayerId]?.name ?? 'opponent' : null
  return { text: `Turn ${game.turn}${phase ? ` · ${owner} ${phase}` : ''}`, mine, waiting }
}

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)
}

// Forge's pass-priority prompt is a status dump ("Priority: You / Turn: 8 / ... / Stack: Empty"); say what it means instead.
function promptText(message: string | undefined, stackTop: string | undefined) {
  if (!message?.startsWith('Priority:')) return message
  return stackTop ? `Respond to ${stackTop}, or pass to let it resolve.` : 'Play a card or ability, or pass.'
}

export function PromptBar() {
  const prompt = useForge((s) => s.prompt)
  const buttons = useForge((s) => s.buttons)
  const notices = useForge((s) => s.notices)
  const stackTop = useForge((s) => (s.stack[0]?.sourceCardId != null ? s.cards[s.stack[0].sourceCardId]?.name : undefined) ?? s.stack[0]?.text)
  const { text, mine, waiting } = usePhaseText()

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
  const focusOk = buttons?.focusOk ?? true

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = useForge.getState()
      if (s.ask || s.gameOver || isTyping(e.target) || e.altKey || e.metaKey) return
      const b = s.buttons
      if ((e.key === ' ' || e.key === 'Enter') && !e.ctrlKey) {
        if (e.target instanceof Node && root.current?.contains(e.target)) return // the bar's own focused button handles it
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
    <div
      ref={root}
      key={shake}
      title={text}
      className={`flex h-[56px] w-[min(100%,620px)] items-center gap-3 rounded-xl border bg-panel/95 px-3 shadow-xl shadow-black/30 backdrop-blur
        ${shake ? 'shell-shake' : ''} ${mine ? 'border-accent/60' : 'border-line/70'}`}
    >
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-snug text-ink">{promptText(prompt?.message, stackTop) || (waiting ? `Waiting for ${waiting}…` : ' ')}</p>
      </div>
      {showOk && (
        <button type="button" disabled={!ok.enabled} onClick={() => send({ t: 'ok' })}
          className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm whitespace-nowrap transition duration-150 disabled:opacity-35
            ${focusOk ? 'bg-accent font-semibold text-table hover:brightness-110' : 'border border-line bg-panel-2 text-ink hover:bg-line'}`}>
          {ok.label || 'OK'}
          {ok.enabled && <span className="opacity-60"><Kbd>Space</Kbd></span>}
        </button>
      )}
      {showCancel && (
        <button type="button" disabled={!cancel.enabled} onClick={() => send({ t: 'cancel' })}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm whitespace-nowrap text-ink transition duration-150 hover:bg-line disabled:opacity-35">
          {cancel.label || 'Cancel'}
          {cancel.enabled && <span className="opacity-60"><Kbd>Esc</Kbd></span>}
        </button>
      )}
    </div>
  )
}
