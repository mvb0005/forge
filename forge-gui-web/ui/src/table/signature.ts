import { chooseFocus, combatRoles, groupKey } from '../board/layout'
import type { PlayerDto } from '../protocol'
import type { ForgeState } from '../store'
import { foldsLands, opponentIds, showEveryOpponent, tableMode } from './layouts'

// Store subscriptions for the card layer (docs/PLAN.md, "Subscriptions by id"). The layer
// subscribes to one string: the table's structure. It changes when a card changes zone, row or
// group, taps, gets a combat role or a highlight, or when a player's lands unfold from the ribbon; it doesn't change for P/T, damage or text on a
// card that stays in its group. Card elements subscribe to their own card.

type Focus = { playerId: number; turn: number } | null

export function seatIds(s: ForgeState, userFocus: Focus) {
  const players = Object.values(s.players).sort((a, b) => a.id - b.id)
  const meId = s.game?.localPlayerIds[0] ?? players[0]?.id ?? null
  if (meId == null) return { meId: null, focusId: null }
  const opps = players.filter((p) => p.id !== meId)
  if (userFocus && userFocus.turn === s.game?.turn && opps.some((p) => p.id === userFocus.playerId)) return { meId, focusId: userFocus.playerId }
  return { meId, focusId: chooseFocus(players, meId, s.game, s.combat, s.cards) ?? opps[0]?.id ?? null }
}

let last: { deps: unknown[]; sig: string } | null = null

export function tableSignature(s: ForgeState, meId: number | null, focusId: number | null): string {
  const deps = [s.cards, s.players, s.combat, s.game?.phase, s.highlighted, s.stack, s.selectable, s.game?.activePlayerId, s.game?.turnOrder, s.game?.localPlayerIds, meId, focusId]
  if (last && last.deps.every((d, i) => d === deps[i])) return last.sig
  const sig = compute(s, meId, focusId)
  last = { deps, sig }
  return sig
}

function compute(s: ForgeState, meId: number | null, focusId: number | null) {
  if (meId == null) return ''
  const roles = combatRoles(s.combat)
  const opps = opponentIds(s.players, meId, s.game?.turnOrder)
  const every = showEveryOpponent(opps.length)
  const active = every ? s.game?.activePlayerId ?? null : null
  // Every band is drawn. The active player is named so their taller band rebuilds the table.
  const mark = every ? `all:${opps.join(',')}:${active ?? '-'}` : String(focusId)
  const out: string[] = [tableMode(s.combat, s.game?.phase), String(meId), mark, String(Object.keys(s.players).length), s.game?.localPlayerIds.join(',') ?? '']
  const field = (p: PlayerDto | undefined) => {
    if (!p) return
    // Group partition: each card names the lowest id sharing its group key (cards are visited in
    // zone order, so keep the minimum explicitly). A power/toughness change keeps the same head
    // unless the card leaves its group, so it does not rebuild the layout.
    const heads = new Map<string, number>()
    const keys: (string | null)[] = []
    for (const id of p.zones.battlefield) {
      const c = s.cards[id]
      const role = roles.get(id)
      const k = c ? groupKey(c, role, s.highlighted.has(`card:${id}`)) : null
      keys.push(k)
      if (k !== null) heads.set(k, Math.min(heads.get(k) ?? id, id))
    }
    p.zones.battlefield.forEach((id, i) => {
      const c = s.cards[id]
      if (!c) return out.push(`${id}?`)
      const k = keys[i]
      const lane = c.types.includes('Creature') ? 'c' : c.types.includes('Planeswalker') || c.types.includes('Battle') ? 'w' : c.types.includes('Land') ? `l${c.faceDown ? '' : c.name}` : 'o'
      out.push(
        `${id}:${k === null ? '' : heads.get(k)}:${lane}:${c.tapped ? 't' : ''}:${c.attachedToId ?? ''}:${c.attachmentIds.join('+')}:${c.heldExileIds.length}:${roles.get(id)?.key ?? ''}`,
      )
    })
    const fold = foldsLands(p.zones.battlefield.map((id) => s.cards[id]).filter(Boolean), s.selectable.cardIds)
    out.push('|', fold ? 'fold' : 'lands', p.zones.hand.join(','), p.zones.graveyard.slice(-3).join(','), p.zones.exile.slice(-3).join(','), p.zones.command.join(','))
  }
  field(s.players[meId])
  out.push(`cmd:${s.players[meId]?.commanders?.map((c) => c.cardId).join(',') ?? ''}`)
  if (every) for (const id of opps) field(s.players[id])
  else if (focusId != null) field(s.players[focusId])
  for (const item of s.stack) out.push(`s${item.id}:${item.sourceCardId}:${item.sourceCardId != null ? s.cards[item.sourceCardId]?.zone : ''}`)
  return out.join(' ')
}
