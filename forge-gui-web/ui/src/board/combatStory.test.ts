import { describe, expect, it } from 'vitest'
import type { CardDto, CombatAssist, CombatDto, PlayerDto } from '../protocol'
import { combatStory, type CombatMemo } from './combatStory'

const player = (id: number, name: string, life: number) => ({ id, name, life }) as PlayerDto
const card = (id: number, name: string, zone: CardDto['zone'] = 'battlefield') => ({ id, name, zone }) as CardDto
const cards = { 10: card(10, 'Serra Angel'), 11: card(11, 'Hill Giant'), 20: card(20, 'Grizzly Bears') }
const players = { 1: player(1, 'Matt', 20), 2: player(2, 'AI 1', 20) }
const attack: CombatDto = { bands: [{ attackerIds: [10, 11], defender: { kind: 'player', id: 1 }, blockerIds: [], plannedBlockerIds: [] }] }
const base = { turn: 4, activeId: 2, localIds: [1], players, cards, memo: null }

describe('combatStory', () => {
  it('says who attacks whom and what gets through if nothing blocks', () => {
    const assist: CombatAssist = { attackers: [], blockers: [], players: [{ id: 1, lifeAfter: 13, poisonAfter: 0, lethal: false }] }
    const s = combatStory({ ...base, phase: 'COMBAT_DECLARE_ATTACKERS', combat: attack, assist })!
    expect(s.steps.map((x) => x.state)).toEqual(['now', 'next', 'next'])
    expect(s.lines).toEqual(['AI 1 attacks you with 2 creatures', 'You: 20 → 13 if unblocked'])
  })

  it('says how many are blocked and what would die, from the engine', () => {
    const blocked: CombatDto = { bands: [{ ...attack.bands[0], attackerIds: [11], blockerIds: [20] }, { ...attack.bands[0], attackerIds: [10] }] }
    const assist: CombatAssist = { attackers: [{ id: 11, dies: false, damage: 0 }], blockers: [{ id: 20, dies: true }], players: [{ id: 1, lifeAfter: 16, poisonAfter: 0, lethal: false }] }
    const s = combatStory({ ...base, phase: 'COMBAT_DECLARE_BLOCKERS', combat: blocked, assist })!
    expect(s.steps.map((x) => x.state)).toEqual(['done', 'now', 'next'])
    expect(s.lines).toEqual(['AI 1 attacks you with 2 creatures', 'You block 1 of 2', 'You: 20 → 16', 'Would die: Grizzly Bears'])
  })

  it('recaps what happened after damage: life since combat began and who died', () => {
    const memo: CombatMemo = { turn: 4, attackerId: 2, life: { 1: 20, 2: 20 }, ids: [10, 11, 20], names: { 10: 'Serra Angel', 11: 'Hill Giant', 20: 'Grizzly Bears' } }
    const after = { ...base, players: { ...players, 1: player(1, 'Matt', 16) }, cards: { ...cards, 20: card(20, 'Grizzly Bears', 'graveyard') }, memo }
    expect(combatStory({ ...after, phase: 'COMBAT_END', combat: attack, assist: null })!.lines).toEqual(['Damage dealt', 'You: 20 → 16', 'Died: Grizzly Bears'])
    const later = combatStory({ ...after, phase: 'MAIN2', combat: null, assist: null })!
    expect(later.over).toBe(true)
    expect(later.lines[0]).toBe('Last combat')
    // on the defender's own turn, until the next combat begins
    expect(combatStory({ ...after, turn: 5, activeId: 1, phase: 'MAIN1', combat: null, assist: null })!.lines[0]).toBe('Last combat · AI 1’s turn')
  })

  it('names both sides when you only watch', () => {
    const pod = { ...base, players: { ...players, 3: player(3, 'AI 2', 20) } }
    const fight: CombatDto = { bands: [{ attackerIds: [10], defender: { kind: 'player', id: 3 }, blockerIds: [], plannedBlockerIds: [] }] }
    const assist: CombatAssist = { attackers: [], blockers: [], players: [{ id: 3, lifeAfter: 16, poisonAfter: 0, lethal: false }] }
    expect(combatStory({ ...pod, phase: 'COMBAT_DECLARE_ATTACKERS', combat: fight, assist })!.lines).toEqual(['AI 1 attacks AI 2 with 1 creature', 'AI 2: 20 → 16 if unblocked'])
  })

  it('says whose choice it is before attackers are declared', () => {
    expect(combatStory({ ...base, phase: 'COMBAT_DECLARE_ATTACKERS', combat: null, assist: null })!.lines).toEqual(['AI 1 is choosing attackers'])
    expect(combatStory({ ...base, activeId: 1, phase: 'COMBAT_DECLARE_ATTACKERS', combat: null, assist: null })!.lines).toEqual(['Choose attackers'])
  })
})
