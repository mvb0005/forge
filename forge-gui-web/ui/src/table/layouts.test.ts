import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../board/fixtures'
import { commanderBoard } from '../board/fixtures/commander'
import { CARD_RATIO } from '../board/layout'
import type { CombatDto } from '../protocol'
import type { ForgeState } from '../store'
import type { LayoutInput, Placement, Region, TableMode } from './contract'
import { isShelfCard, SHELF, shelfRows, shelfWidth, trayGroups, type TrayGroup } from '../board/lands'
import { LAYOUTS, tableMode } from './layouts'
import { tableSignature } from './signature'

const VIEW = { w: 1600, h: 900 }
const overlaps = (a: Region, b: Region) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

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
        // With bands, an attacker can sit in its defender's band (on your side, say), so it is inside either.
        if (p.kind === 'field') expect(inside(p, p.edge === 'bottom' ? regions.top : regions.bottom) || inside(p, p.edge === 'bottom' ? regions.bottom : regions.top), `field ${p.x},${p.y}`).toBe(true)
        if (p.kind === 'hand') expect(p.x >= regions.hand.x - 0.5 && p.x + p.w <= regions.hand.x + regions.hand.w + 0.5).toBe(true)
      }
    })
  }

  for (const players of [4, 2]) {
    it(`draws your commander face up in its slot, clear of the hand (${players} players)`, () => {
      const s = fixture('four')
      if (players === 2) {
        delete s.players![3]
        delete s.players![4]
        s.game = { ...s.game!, activePlayerId: 2 }
        s.combat = null
      }
      const i = input(s, { combat: players === 2 ? null : undefined })
      const { placements, regions } = run(i)
      const id = i.players[i.meId].commanders![0].cardId
      const p = placements.get(id)!
      const slot = regions[`command:${id}`]
      expect(p.kind).toBe('command')
      expect(slot).toMatchObject({ x: p.x, y: p.y, w: p.w })
      for (const h of i.players[i.meId].zones.hand) {
        const hand = placements.get(h)!
        const clear = hand.x >= p.x + p.w || hand.x + hand.w <= slot.x || hand.y >= slot.y + slot.h
        expect(clear, `hand card ${h} clear of the commander`).toBe(true)
      }
    })

    it(`gives every player's commander a slot at the left of their battlefield, clear of its cards (${players} players)`, () => {
      const s = fixture('four')
      if (players === 2) {
        delete s.players![3]
        delete s.players![4]
        s.game = { ...s.game!, activePlayerId: 2 }
        s.combat = null
      }
      const i = input(s, { combat: players === 2 ? null : undefined })
      const { placements, regions } = run(i)
      const fanout = Object.keys(i.players).length > 2
      const xs = new Set<number>()
      for (const p of Object.values(i.players)) {
        for (const c of p.commanders ?? []) {
          const slot = regions[`command:${c.cardId}`]
          expect(slot, `slot for ${p.name}`).toBeDefined()
          xs.add(Math.round(slot.x))
          const border = regions[`border:${p.id}`]
          if (fanout) {
            expect(slot.x, `${p.name}'s commander`).toBeGreaterThanOrEqual(border.x - 1)
            expect(slot.x + slot.w).toBeLessThanOrEqual(border.x + border.w + 1)
            expect(slot.y).toBeGreaterThanOrEqual(border.y - 1)
            expect(slot.y + slot.h).toBeLessThanOrEqual(border.y + border.h + 1)
          }
          for (const id of p.zones.battlefield) {
            const at = placements.get(id)
            if (at?.kind !== 'field' || id === c.cardId) continue
            if (fanout) expect(at.x + at.w, `${p.name}'s card ${id}`).toBeLessThanOrEqual(border.x + 1)
            else expect(at.x, `${p.name}'s card ${id}`).toBeGreaterThanOrEqual(slot.x + slot.w)
          }
        }
      }
      expect(xs.size, 'slots line up').toBe(1)
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

  it('sends a spell on the stack off toward the stack panel and anchors graveyards at the seat', () => {
    const s = fixture('quiet')
    const { placements, regions } = run(input(s))
    const spell = s.stack![0].sourceCardId!
    const p = placements.get(spell)!
    expect(p).toMatchObject({ kind: 'zone', opacity: 0 })
    expect(p.x + p.w).toBeGreaterThanOrEqual(regions.side.x - 1)
    const gy = s.players![1].zones.graveyard
    expect(placements.get(gy[gy.length - 1])).toMatchObject({ kind: 'zone', opacity: 0 })
  })

  it('folds lands into the shelf, and unfolds a player’s lands when one can be chosen', () => {
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

  it('sizes a land shelf in columns of as many rows as fit, wider for a named stack', () => {
    const g = (key: string, name: string | null = null): TrayGroup => ({ key, sym: 'G', name, open: [1], tapped: [] })
    expect(shelfRows(110)).toBe(3)
    expect(shelfRows(230)).toBe(7)
    expect(shelfWidth([], 110)).toBe(0)
    const three = [g('a'), g('b'), g('c')]
    expect(shelfWidth([...three, g('d')], 110) - shelfWidth(three, 110)).toBe(SHELF.cellW + SHELF.colGap)
    expect(shelfWidth([...three, g('d')], 230)).toBe(shelfWidth(three, 230))
    expect(shelfWidth([...three, g('r', 'Sol Ring')], 110) - shelfWidth(three, 110)).toBe(SHELF.cellW + 52 + SHELF.colGap)
    expect(shelfWidth([...three, g('r', 'Sol Ring')], 110, true) - shelfWidth(three, 110)).toBe(SHELF.cellW + SHELF.colGap)
  })

  it('opens a player’s lands onto their battlefield when they ask, and keeps the shelf where it was', () => {
    const s = fixture('pod')
    const i = input(s, { combat: null })
    const lands = i.players[i.meId].zones.battlefield.filter((id) => i.cards[id].types.includes('Land') && !i.cards[id].types.includes('Creature'))
    const folded = run(i)
    const open = run({ ...i, openLands: [i.meId] })
    for (const id of lands) expect(open.placements.get(id)?.kind ?? 'member', `land ${id}`).not.toBe('zone')
    expect(open.regions.meRibbon).toEqual(folded.regions.meRibbon)
    const theirs = i.players[i.focusId!].zones.battlefield.find((id) => i.cards[id].types.includes('Land'))!
    expect(open.placements.get(theirs)).toMatchObject({ kind: 'zone' })
  })

  for (const [id, view] of [['quiet', VIEW], ['pod', VIEW], ['four', VIEW], ['commander', VIEW], ['four', { w: 1568, h: 778 }], ['commander', { w: 1568, h: 778 }], ['four', { w: 1280, h: 720 }], ['commander', { w: 1280, h: 720 }]] as const) {
    it(`carves each land shelf off the right end of its battlefield, clear of the cards (${id}, ${view.w}x${view.h})`, () => {
      const s = fixture(id)
      const i = input(s, { viewport: view })
      const { placements, regions } = run(i)
      const shelves: [number, Region, Region][] = Object.keys(regions).some((k) => k.startsWith('ribbon:'))
        ? Object.keys(i.players).map(Number).map((pid) => [pid, regions[`ribbon:${pid}`], regions[`field:${pid}`]])
        : [[i.focusId!, regions.oppRibbon, regions.top], [i.meId, regions.meRibbon, regions.bottom]]
      const rights = new Set<number>()
      const lefts = new Set<number>()
      for (const [pid, shelf, field] of shelves) {
        expect(shelf.w, `shelf ${pid}`).toBeGreaterThan(0)
        expect(shelf.y).toBeCloseTo(field.y)
        expect(shelf.h).toBeCloseTo(field.h)
        rights.add(Math.round(shelf.x + shelf.w))
        lefts.add(Math.round(shelf.x))
        expect(Math.round(shelf.x + shelf.w)).toBe(Math.round(field.x + field.w))
        for (const cid of i.players[pid].zones.battlefield) {
          const p = placements.get(cid)
          if (!p) continue
          if (p.kind === 'field') expect(p.x + p.w / 2 + (p.rot ? p.w * CARD_RATIO : p.w) / 2, `card ${cid}`).toBeLessThanOrEqual(shelf.x + 0.5)
          if (p.kind === 'zone') expect(p.x >= shelf.x - 0.5 && p.x + p.w <= shelf.x + shelf.w + 0.5 && p.y >= shelf.y && p.y <= shelf.y + shelf.h, `anchor ${cid}`).toBe(true)
        }
      }
      for (const [pid, shelf, field] of shelves) {
        const groups = trayGroups(i.players[pid].zones.battlefield.map((cid) => i.cards[cid]).filter(isShelfCard))
        expect(shelfWidth(groups, field.h, true), `shelf ${pid} fits`).toBeLessThanOrEqual(shelf.w + 0.5)
      }
      expect(lefts.size, 'every shelf starts at the same x').toBe(1)
      expect(rights.size).toBe(1)
    })
  }

  it('keeps the seam and the control panel in place when combat starts', () => {
    const s = fixture('pod')
    const main = run(input(s, { combat: null }))
    const combat = run(input(s))
    expect(combat.regions.line).toEqual(main.regions.line)
    expect(combat.regions.act).toEqual(main.regions.act)
    expect(combat.regions.bottom).toEqual(main.regions.bottom)
    expect(combat.regions.tray.h).toBe(0)
    expect(Object.keys(combat.regions).some((k) => k.startsWith('lane:'))).toBe(true)
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

  it('keeps the pod seat plates apart and clear of the control panel, on a short window too', () => {
    const s = fixture('four')
    for (const h of [600, 680, 768, 900]) {
      for (const active of [1, 2, 3, 4]) {
        const lay = input(s, { viewport: { w: 1366, h }, game: { ...s.game!, activePlayerId: active } })
        const out = run(lay)
        const ids = [1, 2, 3, 4]
        const seats = ids.map((id) => out.regions[`seat:${id}`])
        const act = out.regions.act
        ids.forEach((id, n) => {
          for (let j = n + 1; j < seats.length; j++) expect(overlaps(seats[n], seats[j]), `h ${h}, active ${active}: seats ${id} and ${ids[j]}`).toBe(false)
          if (id === lay.meId) {
            expect(seats[n].y, `your seat starts above the buttons`).toBeLessThanOrEqual(act.y + 1)
            expect(seats[n].y + seats[n].h, `your seat reaches the bottom`).toBeCloseTo(h)
            expect(seats[n].y + seats[n].h, `your seat holds the buttons`).toBeGreaterThanOrEqual(act.y + act.h - 1)
          } else {
            expect(overlaps(seats[n], act), `h ${h}, active ${active}: seat ${id} and the panel`).toBe(false)
          }
        })
      }
    }
  })

  it('keeps every player on the table, and gives the active player the taller band', () => {
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
    for (const id of [1, 2, 3, 4]) expect(mine.regions[`half:${id}`]).toBeTruthy()
    expect(mine.regions['half:2'].y).toBeLessThan(mine.regions['half:3'].y)
    expect(mine.regions['half:3'].y).toBeLessThan(mine.regions['half:4'].y)
    expect(mine.regions['half:4'].y).toBeLessThan(mine.regions['half:1'].y)
    expect(mine.regions['half:1'].h).toBeGreaterThan(mine.regions['half:2'].h * 1.5)
    expect(mine.regions['half:2'].h).toBeCloseTo(mine.regions['half:4'].h)
    // Every player's border is the right end of their own band, clear of the battlefield.
    // Yours continues to the bottom of the screen so the buttons sit inside it.
    const me = input(s, { game: { ...s.game!, activePlayerId: 1, priorityPlayerId: 1 }, focusId: 2 }).meId
    for (const id of [1, 2, 3, 4]) {
      const border = mine.regions[`border:${id}`]
      const field = mine.regions[`field:${id}`]
      const half = mine.regions[`half:${id}`]
      expect(border.x).toBeGreaterThanOrEqual(field.x + field.w - 1)
      expect(border.y).toBeCloseTo(half.y)
      if (id === me) {
        expect(border.h).toBeGreaterThan(half.h)
        expect(border.y + border.h).toBeGreaterThanOrEqual(mine.regions.act.y + mine.regions.act.h - 1)
      } else {
        expect(border.h).toBeCloseTo(half.h)
        expect(border.y + border.h).toBeLessThanOrEqual(mine.regions.act.y + 1)
      }
    }
    const seen = covered(mine.placements)
    for (const pid of [1, 2, 3, 4]) for (const id of s.players![pid].zones.battlefield) expect(seen.get(id), `card ${id}`).toBe(1)
    for (const [, p] of mine.placements) {
      if (p.kind !== 'field') continue
      expect(inside(p, p.edge === 'bottom' ? mine.regions.top : mine.regions.bottom), `field ${p.x},${p.y}`).toBe(true)
    }
    const ordered = run(input(s, { game: { ...s.game!, activePlayerId: 1, turnOrder: [1, 4, 2, 3] }, combat: null, mode: 'main' }))
    expect(ordered.regions['half:4'].y).toBeLessThan(ordered.regions['half:2'].y)
    expect(ordered.regions['half:2'].y).toBeLessThan(ordered.regions['half:3'].y)

    // Krenko attacks you: in combat the attacked player has the tall band, the attacker's shrinks.
    const theirs = run(input(s))
    expect(theirs.regions.strips).toBeUndefined()
    for (const id of [1, 2, 3, 4]) expect(theirs.regions[`half:${id}`]).toBeTruthy()
    expect(theirs.regions['half:1'].h).toBeGreaterThan(theirs.regions['half:2'].h * 1.5)
    expect(theirs.regions['half:2'].h).toBeCloseTo(theirs.regions['half:3'].h)
    expect(theirs.regions['half:4'].h).toBeCloseTo(theirs.regions['half:2'].h)
    const focusSeen = covered(theirs.placements)
    for (const pid of [1, 2, 3, 4]) for (const id of s.players![pid].zones.battlefield) expect(focusSeen.get(id), `card ${id}`).toBe(1)
  })

  it("brings each attacker to the player it attacks, over that player's blockers", () => {
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
    const sx = (p: Placement, r: Region) => p.x >= r.x - 1 && p.x + p.w <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h
    expect(sx(at(spirit.id), lay.regions['field:2'])).toBe(true)
    expect(sx(at(knight.id), lay.regions['field:4'])).toBe(true)
    expect(sx(at(atraxa.id), lay.regions['field:2'])).toBe(true)
    // The blocker stands between the attacker and the player it attacks: same row, nearer the border.
    expect(at(atraxa.id).y).toBeCloseTo(at(spirit.id).y)
    expect(at(atraxa.id).x).toBeGreaterThan(at(spirit.id).x)
    expect(at(atraxa.id).x + at(atraxa.id).w).toBeLessThanOrEqual(lay.regions['border:2'].x + 1)
    expect(lay.regions['engage:2']).toBeTruthy()
    // An unblocked attacker leaves a blocker's spot free between it and the player.
    expect(at(knight.id).x + at(knight.id).w * 2).toBeLessThanOrEqual(lay.regions['field:4'].x + lay.regions['field:4'].w + 1)
    expect(lay.regions['half:2'].h).toBeGreaterThan(lay.regions['half:1'].h * 1.5)
    expect(lay.placements.get(urza.id)?.kind).toBe('field')
    const home = Object.values(base.cards).filter((c) => c.name === 'Knight Ally' && c.id !== knight.id)
    expect(home.length).toBeGreaterThan(0)
    expect(lay.placements.get(home[0].id) ?? [...lay.placements.values()].some((p) => p.memberIds?.includes(home[0].id))).toBeTruthy()
    for (const id of [1, 2, 3, 4]) expect(lay.regions[`half:${id}`]).toBeTruthy()
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
    expect(has(theirs, atraxa.id)).toBe(true)
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
