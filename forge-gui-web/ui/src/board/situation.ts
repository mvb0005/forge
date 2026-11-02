import { useEffect, useState } from 'react'
import { stepWords } from '../look/phase'
import { useForge } from '../store'

// Forge's pass-priority prompt is a status dump ("Priority: You / Turn: 8 / ... / Stack: Empty"); say what it means instead.
// The engine asks the commander question (CR 903.9a) in the rule's own words; say it as a question.
const COMMAND_ZONE = /^(.+?): If a commander is in a graveyard or in exile .* its owner may put it into the command zone\.?$/s

export function promptText(message: string | undefined, stackTop: string | undefined) {
  const cmd = message?.match(COMMAND_ZONE)
  if (cmd) return `Move ${cmd[1]} to the command zone?`
  if (!message?.startsWith('Priority:')) return message
  return stackTop ? `Respond to ${stackTop}, or pass to let it resolve` : 'Play a land, cast a spell, or pass'
}

/** What the engine is asking: the prompt, or who we're waiting for. */
export function usePrompt() {
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

/** Whole seconds until the server passes priority for you, ticking; null when it isn't timing you. */
export function useRespondCountdown() {
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

export function usePhaseLine() {
  const turn = useForge((s) => s.game?.turn ?? 0)
  const phase = useForge((s) => s.game?.phase ?? null)
  const activeId = useForge((s) => s.game?.activePlayerId ?? null)
  const me = useForge((s) => (activeId != null && s.game?.localPlayerIds.includes(activeId) ? true : false))
  const name = useForge((s) => (activeId == null ? '' : s.players[activeId]?.name ?? ''))
  const step = stepWords(phase)
  const who = !name ? 'Opening' : me ? 'Your turn' : `${name}'s turn`
  return { who: turn > 0 ? `${who} · ${turn}` : who, step, phase }
}
