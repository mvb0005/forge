import { beforeEach, describe, expect, it } from 'vitest'
import type { CombatDto, GameWire, PhaseName, PlayerDto, ServerMessage } from './protocol'
import { useForge } from './store'

const game = (turn: number, phase: PhaseName, activePlayerId = 2) =>
  ({ turn, phase, activePlayerId, priorityPlayerId: null, localPlayerIds: [1], gameOver: false, winner: null }) as GameWire
const players = (me: number, them = 20) => [{ id: 1, name: 'Matt', life: me }, { id: 2, name: 'AI 1', life: them }] as PlayerDto[]
const attack = (ids: number[]): CombatDto => ({ bands: [{ attackerIds: ids, defender: { kind: 'player', id: 1 }, blockerIds: [], plannedBlockerIds: [] }] })
let seq = 0
const state = (m: Partial<Extract<ServerMessage, { t: 'state' }>>) => useForge.getState().apply({ t: 'state', seq: ++seq, full: false, ...m } as ServerMessage)

describe('combat memo', () => {
  beforeEach(() => {
    useForge.getState().apply({ t: 'state', seq: ++seq, full: true, game: game(4, 'MAIN1'), players: players(20),
      cards: [{ id: 7, name: 'Hill Giant', zone: 'battlefield' }] as never } as ServerMessage)
  })

  it('keeps the life from before combat and who attacked, until something attacks in a later combat', () => {
    state({ game: game(4, 'COMBAT_DECLARE_ATTACKERS'), combat: attack([7]) })
    state({ game: game(4, 'COMBAT_END'), players: players(17) })
    state({ game: game(4, 'MAIN2'), combat: null })
    expect(useForge.getState().combatMemo).toMatchObject({ turn: 4, attackerId: 2, life: { 1: 20, 2: 20 }, ids: [7], names: { 7: 'Hill Giant' } })

    state({ game: game(5, 'COMBAT_BEGIN', 1) }) // a combat with no attacks leaves the recap alone
    state({ game: game(5, 'MAIN2', 1) })
    expect(useForge.getState().combatMemo?.turn).toBe(4)

    state({ game: game(6, 'COMBAT_DECLARE_ATTACKERS'), combat: attack([7]) })
    expect(useForge.getState().combatMemo).toMatchObject({ turn: 6, life: { 1: 17 } })
  })
})

describe('reveals', () => {
  beforeEach(() => {
    useForge.getState().apply({ t: 'state', seq: ++seq, full: true, game: game(3, 'MAIN1'), players: players(20), logReset: true, logAppend: [{ type: 'LAND', message: 'AI 1 played Island' }],
      cards: [{ id: 7, name: 'Hill Giant', zone: 'hand', ownerId: 2, hidden: false }, { id: 8, name: 'Island', zone: 'library', ownerId: 2, hidden: false }] as never } as ServerMessage)
  })

  it('keeps each reveal with its revealer, the cards as revealed, and the log entry before it', () => {
    const { apply } = useForge.getState()
    apply({ t: 'reveal', title: '', cardIds: [7, 8] })
    const r = useForge.getState().reveal!
    expect(r).toMatchObject({ ownerId: 2, cardIds: [7, 8], after: { message: 'AI 1 played Island' } })
    expect(r.cards.map((c) => c.name)).toEqual(['Hill Giant', 'Island'])
    state({ cards: [{ id: 7, name: '', zone: 'hand', ownerId: 2, hidden: true }] as never }) // back to a hidden hand
    expect(useForge.getState().reveals.at(-1)!.cards[0].name).toBe('Hill Giant')

    apply({ t: 'reveal', title: '', cardIds: [7, 8] }) // re-sent after a full state: not a second reveal
    apply({ t: 'reveal', title: 'Looking at cards in AI 1 hand', cardIds: [7, 8] }) // the engine's second word on it
    expect(useForge.getState().reveals.filter((x) => x.cardIds.join() === '7,8')).toHaveLength(1)
    apply({ t: 'reveal', title: 'Matt reveals', cardIds: [8] })
    expect(useForge.getState().reveal!.ownerId).toBe(1) // a player named in the title wins
    apply({ t: 'reveal', title: '', cardIds: [] }) // hidden again
    expect(useForge.getState().reveal).toBeNull()
  })
})
