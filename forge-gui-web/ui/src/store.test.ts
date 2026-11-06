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
