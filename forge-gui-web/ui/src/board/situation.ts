import { useEffect, useState } from 'react'
import { stepWords } from '../look/phase'
import { useForge } from '../store'

// Forge's pass-priority prompt is a status dump ("Priority: You / Turn: 8 / ... / Stack: Empty"); say what it means instead.
// The engine asks the commander question (CR 903.9a) in the rule's own words; say it as a question.
const COMMAND_ZONE = /^(.+?): If a commander is in a graveyard or in exile .* its owner may put it into the command zone\.?$/s

// What the engine says you could play now (its `playable` cards): a land, a spell, an ability on the battlefield.
export type CanPlay = { land: boolean; spell: boolean; ability: boolean }

export function promptText(message: string | undefined, stackTop: string | undefined, can: CanPlay) {
  const cmd = message?.match(COMMAND_ZONE)
  if (cmd) return `Move ${cmd[1]} to the command zone?`
  if (!message?.startsWith('Priority:')) return message
  if (stackTop) return `Respond to ${stackTop}, or pass to let it resolve`
  const options = [can.land && 'play a land', can.spell && 'cast a spell', can.ability && 'use an ability'].filter((o): o is string => !!o)
  if (!options.length) return 'Nothing to play: pass'
  const said = options.length === 1 ? `${options[0]} or pass` : `${options.join(', ')}, or pass`
  return said[0].toUpperCase() + said.slice(1)
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
  // one string, so the selector's answer compares equal while nothing changes
  const canKey = useForge((s) => {
    let land = false, spell = false, ability = false
    for (const id of s.playable) {
      const c = s.cards[id]
      if (!c) continue
      if (c.zone === 'battlefield') ability = true
      else if (/Land/.test(c.typeLine)) land = true
      else spell = true
    }
    return `${+land}${+spell}${+ability}`
  })
  const asked = promptText(message, stackTop, { land: canKey[0] === '1', spell: canKey[1] === '1', ability: canKey[2] === '1' })
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

/** An ability's text without its "Source - " prefix, and the "(Targeting: …)" Forge appends, split off. */
export function abilityText(full: string, sourceName?: string): { text: string; targeting: string } {
  const named = sourceName && full.startsWith(`${sourceName} - `) ? full.slice(sourceName.length + 3) : full
  const m = named.match(/\s*\(Targeting:\s*([^)]*)\)\s*$/)
  return m ? { text: named.slice(0, m.index), targeting: m[1].trim() } : { text: named, targeting: '' }
}
