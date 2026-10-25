import type { CombatDto, GameDto } from '../../protocol'
import type { ForgeState } from '../../store'
import { attach, basic, buildTable, card, creature, many, player, spell } from './factory'

// Synthetic 4-player Commander board for the benchmark: about 150 permanents a player, most of
// them different (so grouping can't hide the size), plus token armies with mixed states.

const BASICS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const
const COLORS = ['W', 'U', 'B', 'R', 'G']

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function seat(pid: number, name: string, isAI: boolean) {
  const r = rng(pid * 7919)
  const col = COLORS[pid % 5]
  const lands = [
    ...many(30, (i) => basic(BASICS[(pid + i) % 5], { tapped: r() < 0.4 })),
    ...many(8, (i) => spell(`Utility Land ${pid}-${i}`, '', '', 'Land', '{T}: Add {C}.', { types: ['Land'], tapped: r() < 0.3 })),
  ]
  const creatures = many(45, (i) =>
    creature(`Creature ${pid}-${i}`, `{${1 + (i % 5)}}{${col}}`, col, 'Beast', 1 + (i % 7), 1 + ((i * 3) % 7), 'Some rules text.', i % 4 === 0 ? ['flying'] : i % 9 === 0 ? ['trample'] : [], {
      tapped: r() < 0.25,
      sick: r() < 0.1,
      counters: r() < 0.15 ? { P1P1: 1 + Math.floor(r() * 3) } : {},
    }),
  )
  const tokenKinds = ['Soldier', 'Goblin', 'Saproling', 'Zombie']
  const tokens = many(40, (i) => {
    const kind = tokenKinds[i % 4]
    return creature(kind, '', col, kind, 1, 1, '', [], { token: true, tapped: i % 5 === 0, counters: i % 11 === 0 ? { P1P1: 1 } : {}, power: i % 11 === 0 ? 2 : 1, toughness: i % 11 === 0 ? 2 : 1 })
  })
  const others = many(20, (i) => spell(`Relic ${pid}-${i}`, `{${1 + (i % 4)}}`, '', i % 2 ? 'Artifact' : 'Enchantment', 'Some static ability.', { tapped: i % 2 === 1 && r() < 0.3 }))
  const treasures = many(4, () => spell('Treasure', '', '', 'Token Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.', { token: true }))
  const walkers = many(2, (i) => spell(`Walker ${pid}-${i}`, '{3}{W}', 'W', 'Legendary Planeswalker — Test', '+1: Something.', { loyalty: 3 + i }))
  const auras = many(4, (i) => spell(`Aura ${pid}-${i}`, '{1}', col, 'Enchantment — Aura', 'Enchant creature', {}))
  auras.forEach((a, i) => attach(a, creatures[i * 3]))
  const commander = creature(`Commander ${pid}`, '{3}{W}{U}', 'WU', 'Legend', 5, 5, 'Commander text.', ['vigilance'], { commander: true })
  return {
    player: player({ id: pid, name, isAI, life: 40 - pid * 3, libraryCount: 50 }),
    battlefield: [...lands, ...creatures, ...tokens, ...others, ...treasures, ...walkers, ...auras, commander],
    hand: isAI ? many(5, () => card({ name: '', hidden: true, zone: 'hand' })) : many(7, (i) => creature(`Hand Card ${i}`, '{2}{G}', 'G', 'Elf', 2, 2, 'Text.')),
    graveyard: many(10, (i) => spell(`Spent Spell ${pid}-${i}`, '{1}{R}', 'R', 'Instant', 'Deal damage.')),
  }
}

const game = (p: Partial<GameDto>): GameDto => ({ turn: 14, phase: 'MAIN1', activePlayerId: 4, priorityPlayerId: 1, localPlayerIds: [1], gameOver: false, winner: null, log: [], ...p })

export function commanderBoard(): Partial<ForgeState> & { attack: CombatDto } {
  const seats = [seat(1, 'You', false), seat(2, 'Atraxa AI', true), seat(3, 'Urza AI', true), seat(4, 'Krenko AI', true)]
  const t = buildTable(seats)
  // Player 4 can swing at you with a mixed force: untapped nontoken creatures and some of its tokens.
  const attackers = seats[3].battlefield.filter((c) => c.types.includes('Creature') && !c.tapped && !c.attachmentIds.length).slice(0, 30)
  const attack: CombatDto = { bands: attackers.map((a) => ({ attackerIds: [a.id], defender: { kind: 'player' as const, id: 1 }, blockerIds: [], plannedBlockerIds: [] })) }
  return {
    ...t,
    game: game({}),
    stack: [],
    combat: null,
    playable: new Set(),
    selectable: { cardIds: new Set(), min: 0, max: 0 },
    highlighted: new Set(),
    prompt: { playerId: 1, message: 'Krenko AI is thinking.', cardId: null },
    buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: false }, focusOk: true },
    attack,
  }
}
