import type { BlockersAssist, CardDto, CombatAssist, CombatDto, GameDto, PhaseName, PlayerDto } from '../protocol'
import type { ForgeState } from '../store'

// /?peek fixture: an opponent attacking you with three creatures, four of yours to block with.

const card = (p: Partial<CardDto> & { id: number; name: string }): CardDto => ({
  zone: 'battlefield', ownerId: 1, controllerId: p.ownerId ?? 1, hidden: false, img: null, backImg: null,
  manaCost: '', colors: '', typeLine: '', types: ['Creature'], text: '', power: null, toughness: null,
  loyalty: null, defense: null, damage: 0, counters: {}, keywords: [], tapped: false, sick: false,
  phasedOut: false, faceDown: false, token: false, attachedToId: null, attachedToPlayerId: null,
  attachmentIds: [], exiledWithId: null, heldExileIds: [], commander: false, sprocket: null, ...p,
})

const player = (id: number, name: string, life: number, battlefield: number[], hand: number[]): PlayerDto => ({
  id, name, isAI: id !== 1, life, poison: 0, counters: {}, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  handCount: hand.length, libraryCount: 40, zones: { hand, battlefield, graveyard: [], exile: [], command: [] },
  avatarImg: null, hasLost: false,
})

export const ME = 1
export const OPP = 2
export const ATTACKERS = [10, 11, 12]
export const MINE = [20, 21, 22, 23]
export const HIDDEN = 30

const opp = { ownerId: OPP }
const cards: CardDto[] = [
  card({ id: 10, ...opp, name: 'Serra Angel', manaCost: '{3}{W}{W}', colors: 'W', typeLine: 'Creature — Angel', power: 4, toughness: 4, keywords: ['flying', 'vigilance'], text: 'Flying, vigilance', tapped: false }),
  card({ id: 11, ...opp, name: 'Boggart Brute', manaCost: '{2}{R}', colors: 'R', typeLine: 'Creature — Goblin Warrior', power: 3, toughness: 2, keywords: ['menace'], text: 'Menace', tapped: true }),
  card({ id: 12, ...opp, name: 'Typhoid Rats', manaCost: '{B}', colors: 'B', typeLine: 'Creature — Rat', power: 1, toughness: 1, keywords: ['deathtouch'], text: 'Deathtouch', tapped: true }),
  card({ id: 20, name: 'Grizzly Bears', manaCost: '{1}{G}', colors: 'G', typeLine: 'Creature — Bear', power: 2, toughness: 2, counters: { P1P1: 1 } }),
  card({ id: 21, name: 'Giant Spider', manaCost: '{3}{G}', colors: 'G', typeLine: 'Creature — Spider', power: 2, toughness: 4, keywords: ['reach'], text: 'Reach' }),
  card({ id: 22, name: 'Llanowar Elves', manaCost: '{G}', colors: 'G', typeLine: 'Creature — Elf Druid', power: 1, toughness: 1, sick: true, text: '{T}: Add {G}.' }),
  card({ id: 23, name: 'Wall of Wood', manaCost: '{G}', colors: 'G', typeLine: 'Creature — Wall', power: 0, toughness: 3, keywords: ['defender'], text: 'Defender', damage: 1 }),
  card({ id: HIDDEN, ...opp, zone: 'hand', name: '', hidden: true, types: [] }),
]

const combat: CombatDto = { bands: [{ attackerIds: ATTACKERS, defender: { kind: 'player', id: ME }, blockerIds: [], plannedBlockerIds: [] }] }

const combatAssist: CombatAssist = {
  attackers: [{ id: 10, dies: false, damage: 4 }, { id: 11, dies: false, damage: 3 }, { id: 12, dies: false, damage: 1 }],
  blockers: [],
  players: [{ id: ME, lifeAfter: 12, poisonAfter: 0, lethal: false }],
}

const blockersAssist: BlockersAssist = {
  attackers: [
    {
      attackerId: 10,
      canBlock: [21],
      cannotBlock: [{ id: 20, reason: 'Flying: needs flying or reach' }, { id: 22, reason: 'Flying: needs flying or reach' }, { id: 23, reason: 'Flying: needs flying or reach' }],
      minBlockers: 1,
    },
    { attackerId: 11, canBlock: [20, 21, 22, 23], cannotBlock: [], minBlockers: 2 },
    { attackerId: 12, canBlock: [20, 21, 22, 23], cannotBlock: [], minBlockers: 1 },
  ],
}

export const PHASES: PhaseName[] = ['MAIN1', 'COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS']

export function peekFixture(phase: PhaseName): Partial<ForgeState> {
  const game: GameDto = { turn: 5, phase, activePlayerId: OPP, priorityPlayerId: ME, localPlayerIds: [ME], gameOver: false, winner: null, log: [] }
  const inCombat = phase !== 'MAIN1'
  return {
    inMatch: true,
    game,
    players: { [ME]: player(ME, 'You', 20, MINE, []), [OPP]: player(OPP, 'Opponent', 17, ATTACKERS, [HIDDEN]) },
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    combat: inCombat ? combat : null,
    combatAssist: inCombat ? combatAssist : null,
    blockersAssist: phase === 'COMBAT_DECLARE_BLOCKERS' ? blockersAssist : null,
  }
}
