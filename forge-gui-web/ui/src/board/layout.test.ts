import { describe, expect, it } from 'vitest'
import type { CardDto, CombatDto } from '../protocol'
import { chooseFocus, combatColumns, fitLane, groupBattlefield, pickFromGroup, placeLane } from './layout'
import { basic, card, player } from './fixtures/factory'

const scute = (id: number, p: Partial<CardDto> = {}) =>
  card({ id, name: 'Scute Swarm', token: true, types: ['Creature'], power: 1, toughness: 1, ...p })

describe('groupBattlefield', () => {
  it('groups identical tokens and splits the moment one differs', () => {
    const cards = [scute(1), scute(2), scute(3, { tapped: true }), scute(4), scute(5, { counters: { P1P1: 1 } }), scute(6, { damage: 1 })]
    const { creatures } = groupBattlefield(cards, null)
    expect(creatures.map((g) => g.ids)).toEqual([[1, 2, 4], [3], [5], [6]])
  })

  it('splits on sickness, phasing, token-ness, P/T and keywords', () => {
    const cards = [
      scute(1),
      scute(2, { sick: true }),
      scute(3, { phasedOut: true }),
      scute(4, { token: false }),
      scute(5, { power: 2 }),
      scute(6, { keywords: ['flying'] }),
      scute(7),
    ]
    expect(groupBattlefield(cards, null).creatures.map((g) => g.ids)).toEqual([[1, 7], [2], [3], [4], [5], [6]])
  })

  it('treats counter maps with different key order as equal', () => {
    const cards = [scute(1, { counters: { P1P1: 1, CHARGE: 2 } }), scute(2, { counters: { CHARGE: 2, P1P1: 1 } })]
    expect(groupBattlefield(cards, null).creatures).toHaveLength(1)
  })

  it('never groups cards with attachments and hides attached cards', () => {
    const cards = [
      scute(1, { attachmentIds: [9] }),
      scute(2),
      scute(3),
      card({ id: 9, name: 'Rancor', types: ['Enchantment'], attachedToId: 1 }),
    ]
    const lanes = groupBattlefield(cards, null, { isVisible: () => true })
    expect(lanes.creatures.map((g) => g.ids)).toEqual([[1], [2, 3]])
    expect(lanes.others).toHaveLength(0)
  })

  it('keeps an attached card in a lane when its host is not visible', () => {
    const cards = [card({ id: 9, name: 'Rancor', types: ['Enchantment'], attachedToId: 77 })]
    expect(groupBattlefield(cards, null, { isVisible: () => false }).others).toHaveLength(1)
  })

  it('sorts permanents into lanes', () => {
    const cards = [
      basic('Forest', { id: 1 }),
      card({ id: 2, name: 'Dryad Arbor', types: ['Land', 'Creature'], power: 1, toughness: 1 }),
      card({ id: 3, name: 'Jace', types: ['Planeswalker'], loyalty: 3 }),
      card({ id: 4, name: 'Invasion of Zendikar', types: ['Battle'], defense: 3 }),
      card({ id: 5, name: 'Sol Ring', types: ['Artifact'] }),
      scute(6),
    ]
    const l = groupBattlefield(cards, null)
    expect(l.creatures.map((g) => g.top.name)).toEqual(['Dryad Arbor', 'Scute Swarm'])
    expect(l.walkers.map((g) => g.top.name)).toEqual(['Jace', 'Invasion of Zendikar'])
    expect(l.lands.map((p) => p.name)).toEqual(['Forest'])
    expect(l.others.map((g) => g.top.name)).toEqual(['Sol Ring'])
  })

  it('piles lands by name with tapped counts and sub-groups', () => {
    const cards = [
      basic('Forest', { id: 3 }),
      basic('Island', { id: 1 }),
      basic('Forest', { id: 5, tapped: true }),
      basic('Forest', { id: 7 }),
      basic('Forest', { id: 9, tapped: true }),
      basic('Forest', { id: 11 }),
    ]
    const { lands } = groupBattlefield(cards, null)
    expect(lands.map((p) => [p.name, p.ids.length, p.tapped])).toEqual([
      ['Island', 1, 0],
      ['Forest', 5, 2],
    ])
    expect(lands[1].groups.map((g) => g.ids)).toEqual([[3, 7, 11], [5, 9]])
  })

  it('orders groups by their lowest id, so unrelated changes do not move them', () => {
    const before = groupBattlefield([scute(10), scute(4), card({ id: 7, name: 'Bear', types: ['Creature'], power: 2, toughness: 2 }), scute(2)], null)
    expect(before.creatures.map((g) => g.ids[0])).toEqual([2, 7])
    // the bear taps: nothing else moves
    const after = groupBattlefield(
      [scute(10), scute(4), card({ id: 7, name: 'Bear', types: ['Creature'], power: 2, toughness: 2, tapped: true }), scute(2)],
      null,
    )
    expect(after.creatures.map((g) => g.key)).toEqual(before.creatures.map((g) => g.key))
    // a token leaves the group: it slots in by its own id
    const split = groupBattlefield([scute(10, { tapped: true }), scute(4), card({ id: 7, name: 'Bear', types: ['Creature'], power: 2, toughness: 2 }), scute(2)], null)
    expect(split.creatures.map((g) => g.ids)).toEqual([[2, 4], [7], [10]])
  })

  it('splits by highlight when asked', () => {
    const l = groupBattlefield([scute(1), scute(2), scute(3)], null, { highlighted: new Set(['card:2']) })
    expect(l.creatures.map((g) => g.ids)).toEqual([[1, 3], [2]])
  })
})

describe('combat roles', () => {
  const combat: CombatDto = {
    bands: [
      { attackerIds: [1], defender: { kind: 'player', id: 2 }, blockerIds: [], plannedBlockerIds: [] },
      { attackerIds: [2], defender: { kind: 'player', id: 2 }, blockerIds: [], plannedBlockerIds: [] },
      { attackerIds: [3], defender: { kind: 'card', id: 50 }, blockerIds: [], plannedBlockerIds: [] },
      { attackerIds: [4], defender: { kind: 'player', id: 2 }, blockerIds: [20], plannedBlockerIds: [] },
      { attackerIds: [5], defender: { kind: 'player', id: 2 }, blockerIds: [21, 22], plannedBlockerIds: [] },
    ],
  }
  const attackers = [scute(1), scute(2), scute(3), scute(4), scute(5), scute(6)]
  const blockers = [
    card({ id: 20, name: 'Wall', types: ['Creature'], power: 0, toughness: 4, controllerId: 2 }),
    card({ id: 21, name: 'Wall', types: ['Creature'], power: 0, toughness: 4, controllerId: 2 }),
    card({ id: 22, name: 'Wall', types: ['Creature'], power: 0, toughness: 4, controllerId: 2 }),
    card({ id: 23, name: 'Wall', types: ['Creature'], power: 0, toughness: 4, controllerId: 2 }),
  ]

  it('groups unblocked attackers by defender and keeps blocked bands apart', () => {
    const l = groupBattlefield(attackers, combat)
    expect(l.creatures.map((g) => [g.ids, g.role])).toEqual([
      [[1, 2], 'attacker'],
      [[3], 'attacker'],
      [[4], 'attacker'],
      [[5], 'attacker'],
      [[6], null],
    ])
  })

  it('groups blockers by the attacker they block', () => {
    const l = groupBattlefield(blockers, combat)
    expect(l.creatures.map((g) => [g.ids, g.role, g.attackerIds])).toEqual([
      [[20], 'blocker', [4]],
      [[21, 22], 'blocker', [5]],
      [[23], null, []],
    ])
  })

  it('lines blockers up in their attacker column', () => {
    const top = groupBattlefield(attackers, combat).creatures
    const bottom = groupBattlefield(blockers, combat).creatures
    const { columns, topRest, bottomRest } = combatColumns(top, bottom)
    expect(columns.map((c) => [c.top.map((g) => g.ids[0]), c.bottom.map((g) => g.ids[0]), c.slots])).toEqual([
      [[1], [], 1],
      [[3], [], 1],
      [[4], [20], 1],
      [[5], [21], 1],
    ])
    expect(topRest.map((g) => g.ids)).toEqual([[6]])
    expect(bottomRest.map((g) => g.ids)).toEqual([[23]])
  })

  it('gives a column extra slots for several different blockers', () => {
    const c2: CombatDto = { bands: [{ attackerIds: [1], defender: { kind: 'player', id: 2 }, blockerIds: [20, 30], plannedBlockerIds: [] }] }
    const top = groupBattlefield([scute(1)], c2).creatures
    const bottom = groupBattlefield([blockers[0], card({ id: 30, name: 'Bear', types: ['Creature'], power: 2, toughness: 2 })], c2).creatures
    const { columns } = combatColumns(top, bottom)
    expect(columns).toHaveLength(1)
    expect(columns[0].slots).toBe(2)
  })
})

describe('fitLane / placeLane', () => {
  const o = { minW: 40, maxW: 160, slotX: 1.1, slotY: 1.1 }
  it('uses the max width when there is room', () => {
    expect(fitLane([{ key: 'a', slots: 1 }], 1000, 400, o).w).toBe(160)
  })
  it('shrinks to fit many items in one row', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ key: `${i}`, slots: 1 }))
    const { w, step } = fitLane(items, 800, 150, o)
    expect(w).toBeLessThan(160)
    expect(9 * step + w).toBeLessThanOrEqual(800)
  })
  it('wraps into rows before going below the minimum', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ key: `${i}`, slots: 1 }))
    const { w, step } = fitLane(items, 600, 400, o)
    expect(w).toBeGreaterThanOrEqual(40)
    const pos = placeLane(items, 600, 400, w, step, w * (88 / 63) * 1.1, false)
    for (const p of pos.values()) {
      expect(p.x + w).toBeLessThanOrEqual(600 + 0.01)
      expect(p.y + w * (88 / 63) * 1.1).toBeLessThanOrEqual(400 + 0.01)
    }
  })
  it('overlaps at the minimum size instead of overflowing', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ key: `${i}`, slots: 1 }))
    const { w, step } = fitLane(items, 500, 70, o)
    expect(w).toBe(40)
    expect(step).toBeLessThan(40)
    expect(49 * step + w).toBeLessThanOrEqual(500 + 0.01)
  })
  it('pushes end items to the right on a single row', () => {
    const pos = placeLane([{ key: 'a', slots: 1 }, { key: 'pw', slots: 1, end: true }], 1000, 200, 100, 110, 150, false)
    expect(pos.get('a')!.x).toBe(0)
    expect(pos.get('pw')!.x).toBe(900)
  })
})

describe('chooseFocus', () => {
  const ps = [player({ id: 1, name: 'me' }), player({ id: 2, name: 'b' }), player({ id: 3, name: 'c' }), player({ id: 4, name: 'd' })]
  const cards = { 50: scute(50, { controllerId: 4 }) }
  it('prefers whoever is attacking you', () => {
    const combat: CombatDto = { bands: [{ attackerIds: [50], defender: { kind: 'player', id: 1 }, blockerIds: [], plannedBlockerIds: [] }] }
    expect(chooseFocus(ps, 1, null, combat, cards)).toBe(4)
  })
  it('then the active player, then the next opponent', () => {
    const game = { turn: 3, phase: null, activePlayerId: 3, priorityPlayerId: 3, localPlayerIds: [1], gameOver: false, winner: null, log: [] }
    expect(chooseFocus(ps, 1, game, null, cards)).toBe(3)
    expect(chooseFocus(ps, 1, { ...game, activePlayerId: 1 }, null, cards)).toBe(2)
  })
})

describe('pickFromGroup', () => {
  const cards = { 1: scute(1, { tapped: true }), 2: scute(2), 3: scute(3) }
  it('prefers selectable, then untapped cards', () => {
    expect(pickFromGroup([1, 2, 3], cards, new Set(), new Set(), new Set()).cardId).toBe(2)
    expect(pickFromGroup([1, 2, 3], cards, new Set([1, 3]), new Set(), new Set())).toEqual({ cardId: 3, others: [1] })
    expect(pickFromGroup([1, 2, 3], cards, new Set([2, 3]), new Set(), new Set(['card:2']))).toEqual({ cardId: 3, others: [2] })
  })
})
