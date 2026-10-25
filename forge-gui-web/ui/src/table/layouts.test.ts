import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../board/fixtures'
import { commanderBoard } from '../board/fixtures/commander'
import { CARD_RATIO } from '../board/layout'
import type { CombatDto } from '../protocol'
import type { ForgeState } from '../store'
import type { LayoutInput, Placement, Region, TableMode } from './contract'
import { LAYOUTS, tableMode } from './layouts'

const VIEW = { w: 1600, h: 900 }

function input(s: Partial<ForgeState>, over: Partial<LayoutInput> = {}): LayoutInput {
  const combat = over.combat !== undefined ? over.combat : (s.combat ?? null)
  const meId = s.game!.localPlayerIds[0]
  const focusId = Object.keys(s.players!).map(Number).find((id) => id !== meId) ?? null
  return {
    mode: tableMode(combat),
    viewport: VIEW,
    meId,
    focusId: s.game!.activePlayerId !== meId ? s.game!.activePlayerId : focusId,
    game: s.game!,
    players: s.players!,
    cards: s.cards!,
    combat,
    highlighted: s.highlighted ?? new Set(),
    stack: s.stack ?? [],
    ...over,
  }
}

const run = (i: LayoutInput) => LAYOUTS[i.mode](i)
const inside = (p: Placement, r: Region) => p.x >= r.x - 0.5 && p.y >= r.y - 0.5 && p.x + p.w <= r.x + r.w + 0.5 && p.y + p.w * CARD_RATIO <= r.y + r.h + 0.5
const fixture = (id: string) => FIXTURES.find((f) => f.id === id)!.state()

describe('table layouts', () => {
  it('is pure: same input, same output', () => {
    const s = fixture('quiet')
    expect(run(input(s))).toEqual(run(input(s)))
  })

  for (const id of ['quiet', 'pod', 'four', 'commander']) {
    it(`places every shown card exactly once, inside its region (${id})`, () => {
      const s = fixture(id)
      const i = input(s)
      const { placements, regions } = run(i)
      const me = i.players[i.meId]
      const opp = i.players[i.focusId!]
      const covered = new Map<number, number>()
      for (const [pid, p] of placements) for (const id of [pid, ...(p.memberIds ?? [])]) covered.set(id, (covered.get(id) ?? 0) + 1)
      for (const id of [...me.zones.battlefield, ...opp.zones.battlefield, ...me.zones.hand]) expect(covered.get(id), `card ${id}`).toBe(1)
      for (const [, p] of placements) {
        if (p.kind === 'field') expect(inside(p, p.edge === 'bottom' ? regions.top : regions.bottom), `field ${p.x},${p.y}`).toBe(true)
        if (p.kind === 'hand') expect(p.x >= regions.hand.x - 0.5 && p.x + p.w <= regions.hand.x + regions.hand.w + 0.5).toBe(true)
      }
    })
  }

  it('keys a group by its lowest id with the rest as members', () => {
    const s = fixture('pod')
    const { placements } = run(input(s))
    const groups = [...placements].filter(([, p]) => p.count)
    expect(groups.length).toBeGreaterThan(0)
    for (const [id, p] of groups) {
      expect(p.memberIds).toHaveLength(p.count! - 1)
      expect(Math.min(id, ...p.memberIds!)).toBe(id)
    }
  })

  it('draws attachments as their own cards just above the host', () => {
    const s = fixture('pod')
    const { placements } = run(input(s))
    const angel = Object.values(s.cards!).find((c) => c.name === 'Baneslayer Angel')!
    const host = placements.get(angel.id)!
    const atts = angel.attachmentIds.map((a) => placements.get(a)!)
    expect(atts.every((a) => a.kind === 'attach' && a.x === host.x && a.y < host.y && a.z < host.z)).toBe(true)
  })

  it('puts a spell on the stack in its stack slot and anchors graveyards at the seat', () => {
    const s = fixture('quiet')
    const { placements, regions } = run(input(s))
    const spell = s.stack![0].sourceCardId!
    const p = placements.get(spell)!
    expect(p.kind).toBe('stack')
    expect(p.x).toBeGreaterThanOrEqual(regions.stack.x)
    const gy = s.players![1].zones.graveyard
    expect(placements.get(gy[gy.length - 1])).toMatchObject({ kind: 'zone', opacity: 0 })
  })

  it('combat mode lines attackers up and folds the back lanes', () => {
    const s = fixture('pod')
    const main = run(input(s, { combat: null }))
    const combat = run(input(s))
    expect(tableMode(s.combat!)).toBe<TableMode>('combat')
    expect(combat.regions['bottom:back'].h).toBeLessThan(main.regions['bottom:back'].h)
    expect(Object.keys(combat.regions).some((k) => k.startsWith('lane:'))).toBe(true)
    // A blocker sits in its attacker's column.
    const band = s.combat!.bands.find((b) => b.plannedBlockerIds.length)!
    const lane = Object.entries(combat.regions).find(([k]) => k === `lane:col:${band.attackerIds[0]}`)![1]
    const blocker = combat.placements.get(band.plannedBlockerIds[0])!
    expect(blocker.x).toBeGreaterThanOrEqual(lane.x - 0.5)
    expect(blocker.x).toBeLessThan(lane.x + lane.w)
  })

  it('splits only the attacking part of a token group into its own ×N element (D-10)', () => {
    const { attack: _, ...s } = commanderBoard()
    const i = input(s, { combat: null, focusId: 2 })
    const soldiers = i.players[1].zones.battlefield.filter((id) => i.cards[id].name === 'Soldier' && !i.cards[id].tapped && !i.cards[id].counters.P1P1)
    const home = run(i).placements
    const head = home.get(soldiers[0])!
    expect(head.count).toBe(soldiers.length)
    // Four of them attack (they're mine, attacking player 2): one ×4 lane element, the rest stay home.
    const attackers = soldiers.slice(1, 5)
    const combat: CombatDto = { bands: attackers.map((a) => ({ attackerIds: [a], defender: { kind: 'player', id: 2 }, blockerIds: [], plannedBlockerIds: [] })) }
    const fight = run({ ...i, mode: 'combat', combat }).placements
    expect(fight.get(attackers[0])).toMatchObject({ count: 4, memberIds: attackers.slice(1) })
    expect(fight.get(soldiers[0])!.count).toBe(soldiers.length - 4)
  })

  it('leaves room for a second blocker in a menace lane', () => {
    const s = fixture('pod')
    const i = input(s)
    const band = i.combat!.bands.find((b) => b.plannedBlockerIds.length)!
    const plain = run(i).regions[`lane:col:${band.attackerIds[0]}`]
    const att = i.cards[band.attackerIds[0]]
    const cards = { ...i.cards, [att.id]: { ...att, keywords: ['menace'] } }
    const menace = run({ ...i, cards }).regions[`lane:col:${band.attackerIds[0]}`]
    expect(menace.w).toBeGreaterThan(plain.w * 1.5)
  })
})
