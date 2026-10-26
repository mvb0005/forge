import type { ForgeState } from '../../store'
import type { CombatAssist, BlockersAssist, GameDto } from '../../protocol'
import { basic, buildTable, card, creature, player, spell } from '../../board/fixtures/factory'
import { FIXTURES } from '../../board/fixtures'
import type { BasePT } from '../PTPlate'

// Mockup art lives in dev-art/ (git-ignored, copied from the design canvas). Without it cards fall back to text frames.
const files = import.meta.glob('../dev-art/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const ART: Record<string, string> = {}
for (const [p, url] of Object.entries(files)) ART[p.split('/').pop()!.replace('.jpg', '')] = url

const BY_NAME: Record<string, string> = {
  'Shivan Dragon': 'shivan', 'Rakshasa Gravecaller': 'rakshasa', "Knight of Dusk's Shadow": 'dusk', 'Krenko, Tin Street Kingpin': 'krenko',
  'Jhessian Thief': 'thief', 'Llanowar Elves': 'llanowar', 'Wall of Omens': 'omens', 'Birds of Paradise': 'birds', 'Knight of the White Orchid': 'orchid',
  'Eternal Witness': 'witness', 'Elvish Mystic': 'mystic', 'Regal Force': 'regal', 'Angel of the Ruins': 'angel', 'Craterhoof Behemoth': 'hoof',
  'Swords to Plowshares': 'swords', 'Sol Ring': 'solring', 'Lightning Bolt': 'bolt', 'Catacomb Dragon': 'catacomb', 'Slashing Tiger': 'tiger',
  'Perimeter Captain': 'captain', 'Sakura-Tribe Elder': 'ste', Forest: 'forest', Island: 'island', Plains: 'plains', Mountain: 'mountain', Swamp: 'swamp',
}
export const artFor = (name: string): string | null => ART[BY_NAME[name]] ?? null
export const hasArt = Object.keys(ART).length > 0

export type Scene = {
  state: Partial<ForgeState>
  colors: Record<number, string> // fixture colour identity; LiveScene copies this onto the players
  base: Record<number, BasePT> // fixture base P/T where it differs; LiveScene copies this onto the cards
  focusAttacker?: number
  slotHints?: Record<number, { rule: string; through?: string }>
  hint?: string
  ledger?: string
  cmdDamage?: Record<number, { name: string; amount: number }[]>
  threats?: Record<number, string>
  triggers?: Record<number, { will: number; could: number }>
}

const game = (p: Partial<GameDto>): GameDto => ({ turn: 7, phase: 'MAIN1', activePlayerId: 1, priorityPlayerId: 1, localPlayerIds: [1], gameOver: false, winner: null, log: [], ...p })
const none = { cardIds: new Set<number>(), min: 0, max: 0 }

function vexBoard(tappedThief: boolean) {
  return {
    shivan: creature('Shivan Dragon', '{4}{R}{R}', 'R', 'Dragon', 5, 5, 'Flying\n{R}: Shivan Dragon gets +1/+0 until end of turn.', ['flying']),
    rak: creature('Rakshasa Gravecaller', '{4}{B}', 'B', 'Cat Demon', 3, 6, 'Exploit'),
    dusk: creature("Knight of Dusk's Shadow", '{2}{B}', 'B', 'Vampire Knight', 3, 3, 'Menace', ['menace']),
    krenko: creature('Krenko, Tin Street Kingpin', '{2}{R}', 'R', 'Goblin', 1, 2, 'Whenever Krenko attacks, put a +1/+1 counter on it.'),
    thief: creature('Jhessian Thief', '{2}{U}', 'U', 'Human Rogue', 1, 3, 'Prowess', [], { tapped: tappedThief }),
  }
}

function myBoard() {
  return {
    elves: creature('Llanowar Elves', '{G}', 'G', 'Elf Druid', 1, 1, '{T}: Add {G}.'),
    wall: creature('Wall of Omens', '{1}{W}', 'W', 'Wall', 0, 4, 'Defender', ['defender']),
    birds: creature('Birds of Paradise', '{G}', 'G', 'Bird', 0, 1, 'Flying', ['flying']),
    orchid: creature('Knight of the White Orchid', '{W}{W}', 'W', 'Human Knight', 3, 3, 'First strike', ['first strike'], { counters: { '+1/+1': 1 } }),
    witness: creature('Eternal Witness', '{1}{G}{G}', 'G', 'Human Shaman', 2, 1, '', [], { sick: true }),
  }
}

const lands = (spec: [Parameters<typeof basic>[0], number, number][]) =>
  spec.flatMap(([n, count, tapped]) => Array.from({ length: count }, (_, i) => basic(n, { tapped: i < tapped })))

function main(): Scene {
  const v = vexBoard(true)
  const m = myBoard()
  const sol = spell('Sol Ring', '{1}', '', 'Artifact', '{T}: Add {C}{C}.')
  const hand = [
    creature('Elvish Mystic', '{G}', 'G', 'Elf Druid', 1, 1, '{T}: Add {G}.'),
    basic('Forest'),
    creature('Regal Force', '{4}{G}{G}{G}', 'G', 'Elemental', 5, 5),
    creature('Craterhoof Behemoth', '{5}{G}{G}{G}', 'G', 'Beast', 5, 5, 'Haste', ['haste', 'trample']),
    creature('Angel of the Ruins', '{5}{W}{W}', 'W', 'Angel', 5, 7, 'Flying', ['flying']),
    basic('Plains'),
  ]
  const t = buildTable([
    { player: player({ id: 1, name: 'You', isAI: false, life: 20, libraryCount: 38 }), battlefield: [...lands([['Forest', 4, 1], ['Plains', 3, 0]]), sol, ...Object.values(m)], hand, graveyard: [spell('Sakura-Tribe Elder', '{1}{G}', 'G', 'Creature — Snake Shaman', '')] },
    { player: player({ id: 2, name: 'Vex', life: 18, libraryCount: 41 }), battlefield: [...lands([['Island', 3, 0], ['Swamp', 2, 0], ['Mountain', 2, 2]]), ...Object.values(v)], hand: Array.from({ length: 5 }, () => card({ name: '', hidden: true })), graveyard: [spell('Lightning Bolt', '{R}', 'R', 'Instant', '')] },
  ])
  return {
    state: { ...t, game: game({}), stack: [], combat: null, playable: new Set([hand[0].id, hand[1].id, hand[3].id, sol.id]), selectable: none },
    colors: { 1: 'GW', 2: 'UBR' },
    base: { [m.orchid.id]: { power: 2, toughness: 2 } },
    hint: 'Play a land or cast spells',
  }
}

function combat(): Scene {
  const v = vexBoard(false)
  const m = myBoard()
  const t = buildTable([
    { player: player({ id: 1, name: 'You', isAI: false, life: 20, libraryCount: 38 }), battlefield: [...lands([['Forest', 4, 0], ['Plains', 3, 0]]), ...Object.values(m)], hand: [spell('Swords to Plowshares', '{W}', 'W', 'Instant', ''), basic('Forest'), basic('Plains')] },
    { player: player({ id: 2, name: 'Vex', life: 18, libraryCount: 41 }), battlefield: [...lands([['Island', 3, 3], ['Swamp', 2, 1], ['Mountain', 2, 1]]), ...Object.values(v)], hand: Array.from({ length: 5 }, () => card({ name: '', hidden: true })) },
  ])
  v.shivan.tapped = v.dusk.tapped = v.krenko.tapped = true
  const assist: CombatAssist = {
    attackers: [{ id: v.shivan.id, dies: false, damage: 5 }, { id: v.dusk.id, dies: false, damage: 0 }, { id: v.krenko.id, dies: false, damage: 1 }],
    blockers: [{ id: m.wall.id, dies: false }, { id: m.elves.id, dies: true }],
    players: [{ id: 1, lifeAfter: 14, poisonAfter: 0, lethal: false }],
  }
  const blockers: BlockersAssist = {
    attackers: [
      { attackerId: v.shivan.id, canBlock: [m.birds.id], cannotBlock: [m.orchid.id, m.witness.id].map((id) => ({ id, reason: "Can't block a creature with flying" })), minBlockers: 1 },
      { attackerId: v.dusk.id, canBlock: [m.elves.id, m.wall.id, m.birds.id, m.orchid.id, m.witness.id], cannotBlock: [], minBlockers: 2 },
      { attackerId: v.krenko.id, canBlock: [m.elves.id, m.wall.id, m.birds.id, m.orchid.id, m.witness.id], cannotBlock: [], minBlockers: 1 },
    ],
  }
  const band = (a: number, planned: number[] = []) => ({ attackerIds: [a], defender: { kind: 'player' as const, id: 1 }, blockerIds: [], plannedBlockerIds: planned })
  return {
    state: {
      ...t, game: game({ phase: 'COMBAT_DECLARE_BLOCKERS', activePlayerId: 2 }), stack: [], playable: new Set(),
      combat: { bands: [band(v.shivan.id), band(v.dusk.id, [m.wall.id, m.elves.id]), band(v.krenko.id)] },
      combatAssist: assist, blockersAssist: blockers, selectable: { cardIds: new Set([m.birds.id]), min: 0, max: 9 },
    },
    colors: { 1: 'GW', 2: 'UBR' },
    base: { [m.orchid.id]: { power: 2, toughness: 2 } },
    focusAttacker: v.shivan.id,
    slotHints: { [v.shivan.id]: { rule: 'Flyer or reach to block', through: 'else 5 to you' }, [v.krenko.id]: { rule: 'Block', through: 'else 1 to you' } },
    hint: 'Choose a blocker for Shivan Dragon, or click another attacker',
  }
}

function four(): Scene {
  const s = fromFixture('four')
  return {
    ...s,
    colors: { 1: 'WG', 2: 'WUBG', 3: 'U', 4: 'R' },
    cmdDamage: { 1: [{ name: 'Krenko', amount: 7 }] },
    threats: { 3: 'Can hit you for 5 next turn' },
    triggers: { 4: { will: 2, could: 0 }, 2: { will: 0, could: 1 } },
  }
}

function fromFixture(id: string): Scene {
  const f = FIXTURES.find((x) => x.id === id)!
  const state = f.state()
  return { state, colors: {}, base: {} }
}

export const SCENES: Record<string, { label: string; make: () => Scene }> = {
  main: { label: 'Main · mockup', make: main },
  combat: { label: 'Blockers · mockup', make: combat },
  four: { label: '4 players', make: four },
  quiet: { label: 'Fixture: mid-game', make: () => fromFixture('quiet') },
  pod: { label: 'Fixture: token pod', make: () => fromFixture('pod') },
}
