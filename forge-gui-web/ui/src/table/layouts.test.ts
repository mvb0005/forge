import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../board/fixtures'
import { commanderBoard } from '../board/fixtures/commander'
import { CARD_RATIO } from '../board/layout'
import type { CombatDto } from '../protocol'
import type { ForgeState } from '../store'
import type { LayoutInput, Placement, Region, TableMode } from './contract'
import { LAYOUTS, tableMode } from './layouts'
import { tableSignature } from './signature'

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

  it('folds lands into the ribbon, and unfolds a player’s lands when one can be chosen', () => {
    const s = fixture('pod')
    const i = input(s, { combat: null })
    const land = i.players[i.meId].zones.battlefield.find((id) => i.cards[id].types.includes('Land') && !i.cards[id].types.includes('Creature'))!
    const folded = run(i)
    expect(folded.placements.get(land)).toMatchObject({ kind: 'zone', opacity: 0 })
    expect(folded.regions['bottom:back']).toBeUndefined()
    const open = run({ ...i, selectable: new Set([land]) })
    expect(open.placements.get(land)?.kind ?? 'member').not.toBe('zone')
    expect(open.regions['bottom:back'].h).toBeGreaterThan(0)
  })

  it('combat mode lines attackers up and folds the back lanes', () => {
    const s = fixture('pod')
    const land = s.players![1].zones.battlefield.find((id) => s.cards![id].types.includes('Land') && !s.cards![id].types.includes('Creature'))!
    const main = run(input(s, { combat: null, selectable: new Set([land]) }))
    const combat = run(input(s, { selectable: new Set([land]) }))
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

  it('on your turn draws every opponent battlefield, and on theirs only the focused one', () => {
    const s = fixture('four')
    const covered = (placements: Map<number, Placement>) => {
      const n = new Map<number, number>()
      for (const [pid, p] of placements) for (const id of [pid, ...(p.memberIds ?? [])]) n.set(id, (n.get(id) ?? 0) + 1)
      return n
    }
    const mine = run(input(s, { game: { ...s.game!, activePlayerId: 1, priorityPlayerId: 1 }, focusId: 2 }))
    const again = run(input(s, { game: { ...s.game!, activePlayerId: 1, priorityPlayerId: 1 }, focusId: 4 }))
    expect(again.placements).toEqual(mine.placements)
    expect(mine.regions.strips).toBeUndefined()
    for (const id of [2, 3, 4]) expect(mine.regions[`half:${id}`]).toBeTruthy()
    expect(mine.regions['half:2'].x).toBeLessThan(mine.regions['half:3'].x)
    expect(mine.regions['half:3'].x).toBeLessThan(mine.regions['half:4'].x)
    const seen = covered(mine.placements)
    for (const pid of [1, 2, 3, 4]) for (const id of s.players![pid].zones.battlefield) expect(seen.get(id), `card ${id}`).toBe(1)
    for (const [, p] of mine.placements) {
      if (p.kind !== 'field') continue
      expect(inside(p, p.edge === 'bottom' ? mine.regions.top : mine.regions.bottom), `field ${p.x},${p.y}`).toBe(true)
    }
    const ordered = run(input(s, { game: { ...s.game!, activePlayerId: 1, turnOrder: [1, 4, 2, 3] }, combat: null, mode: 'main' }))
    expect(ordered.regions['half:4'].x).toBeLessThan(ordered.regions['half:2'].x)
    expect(ordered.regions['half:2'].x).toBeLessThan(ordered.regions['half:3'].x)

    const theirs = run(input(s))
    expect(theirs.regions.strips).toBeTruthy()
    expect(Object.keys(theirs.regions).some((k) => k.startsWith('half:'))).toBe(false)
    const focusSeen = covered(theirs.placements)
    for (const id of [...s.players![1].zones.battlefield, ...s.players![4].zones.battlefield]) expect(focusSeen.get(id), `card ${id}`).toBe(1)
    for (const id of [...s.players![2].zones.battlefield, ...s.players![3].zones.battlefield]) expect(focusSeen.get(id), `card ${id}`).toBeUndefined()
  })

  it('on your turn lines each attacker up with the defender column', () => {
    const s = fixture('four')
    const base = input(s, { game: { ...s.game!, activePlayerId: 1, phase: 'COMBAT_DECLARE_ATTACKERS' } })
    const spirit = Object.values(base.cards).find((c) => c.name === 'Selfless Spirit')!
    const knight = Object.values(base.cards).find((c) => c.name === 'Knight Ally')!
    const atraxa = Object.values(base.cards).find((c) => c.name.startsWith('Atraxa'))!
    const urza = Object.values(base.cards).find((c) => c.name.startsWith('Urza'))!
    const combat: CombatDto = {
      bands: [
        { attackerIds: [spirit.id], defender: { kind: 'player', id: 2 }, blockerIds: [], plannedBlockerIds: [atraxa.id] },
        { attackerIds: [knight.id], defender: { kind: 'player', id: 4 }, blockerIds: [], plannedBlockerIds: [] },
      ],
    }
    const lay = run({ ...base, mode: 'combat', combat })
    const at = (id: number) => {
      const p = lay.placements.get(id)
      expect(p?.kind, `card ${id}`).toBe('field')
      return p!
    }
    const sx = (p: Placement, r: Region) => p.x >= r.x - 1 && p.x + p.w <= r.x + r.w + 1
    expect(sx(at(spirit.id), lay.regions['field:2'])).toBe(true)
    expect(sx(at(atraxa.id), lay.regions['field:2'])).toBe(true)
    expect(Math.abs(at(spirit.id).x - at(atraxa.id).x)).toBeLessThan(1)
    expect(sx(at(knight.id), lay.regions['field:4'])).toBe(true)
    expect(lay.placements.get(urza.id)?.kind).toBe('field')
    const home = Object.values(base.cards).filter((c) => c.name === 'Knight Ally' && c.id !== knight.id)
    expect(home.length).toBeGreaterThan(0)
    expect(lay.placements.get(home[0].id) ?? [...lay.placements.values()].some((p) => p.memberIds?.includes(home[0].id))).toBeTruthy()
    for (const [, p] of lay.placements) {
      if (p.kind !== 'field') continue
      expect(inside(p, p.edge === 'bottom' ? lay.regions.top : lay.regions.bottom), `field ${p.x},${p.y}`).toBe(true)
    }
  })

  it('signature includes every battlefield drawn, and a P/T change does not rebuild it', () => {
    const s = fixture('four')
    const on = { ...s, game: { ...s.game!, activePlayerId: 1 } } as ForgeState
    const atraxa = Object.values(s.cards!).find((c) => c.name.startsWith('Atraxa'))!
    const krenko = Object.values(s.cards!).find((c) => c.name.startsWith('Krenko'))!
    const has = (sig: string, id: number) => sig.split(' ').some((t) => t.startsWith(`${id}:`))
    const sig = tableSignature(on, 1, 2)
    expect(has(sig, atraxa.id)).toBe(true)
    expect(has(sig, krenko.id)).toBe(true)
    const bumped = { ...on, cards: { ...on.cards!, [atraxa.id]: { ...atraxa, power: (atraxa.power ?? 0) + 5, damage: 3 } } } as ForgeState
    expect(tableSignature(bumped, 1, 2)).toBe(sig)
    const tapped = { ...on, cards: { ...on.cards!, [atraxa.id]: { ...atraxa, tapped: !atraxa.tapped } } } as ForgeState
    expect(tableSignature(tapped, 1, 2)).not.toBe(sig)
    const theirs = tableSignature(s as ForgeState, 1, 4)
    expect(has(theirs, krenko.id)).toBe(true)
    expect(has(theirs, atraxa.id)).toBe(false)
    expect(sig).not.toBe(theirs)
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
