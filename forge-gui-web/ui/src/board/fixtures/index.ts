import type { ForgeState } from '../../store'
import type { CombatDto, GameDto, StackItemDto } from '../../protocol'
import { attach, basic, buildTable, card, creature, holdInExile, many, player, spell } from './factory'

export type Fixture = { id: string; label: string; state: () => Partial<ForgeState> }

const game = (p: Partial<GameDto>): GameDto => ({
  turn: 7,
  phase: 'MAIN1',
  activePlayerId: 1,
  priorityPlayerId: 1,
  localPlayerIds: [1],
  gameOver: false,
  winner: null,
  log: [],
  ...p,
})

const none = { cardIds: new Set<number>(), min: 0, max: 0 }

// ---- (a) quiet two-player mid-game -----------------------------------------------------------

function quiet(): Partial<ForgeState> {
  const champ = creature('Steel Leaf Champion', '{G}{G}{G}', 'G', 'Elf Knight', 7, 4, "Steel Leaf Champion can't be blocked by creatures with power 2 or less.", ['trample'])
  const rancor = spell('Rancor', '{G}', 'G', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+0 and has trample.\nWhen Rancor is put into a graveyard from the battlefield, return Rancor to its owner\'s hand.')
  attach(rancor, champ)
  const pridemate = creature('Ajani\'s Pridemate', '{1}{W}', 'W', 'Cat Soldier', 4, 4, 'Whenever you gain life, put a +1/+1 counter on Ajani\'s Pridemate.', [], {
    counters: { P1P1: 2 },
    damage: 1,
  })
  const apparition = creature('Skyclave Apparition', '{1}{W}{W}', 'W', 'Kor Spirit', 2, 2, 'When Skyclave Apparition enters the battlefield, exile up to one target nonland, nontoken permanent you don\'t control with mana value 4 or less.')
  const exiledHarvester = creature('Bloodtithe Harvester', '{B}{R}', 'BR', 'Vampire', 3, 2, 'When Bloodtithe Harvester enters the battlefield, create a Blood token.', [], { zone: 'exile', ownerId: 2 })
  holdInExile(apparition, exiledHarvester)
  const soldier = () => creature('Soldier', '', 'W', 'Soldier', 1, 1, '', [], { token: true })

  const go = spell('Go for the Throat', '{1}{B}', 'B', 'Instant', 'Destroy target nonartifact creature.')
  const stack: StackItemDto[] = [
    { id: 501, sourceCardId: go.id, activatorId: 2, text: 'Destroy target nonartifact creature. (Targeting: Steel Leaf Champion)', isAbility: false, isTrigger: false, targets: [{ kind: 'card', id: champ.id }] },
  ]

  const flashback = spell('Lingering Souls', '{2}{W}', 'W', 'Sorcery', 'Create two 1/1 white Spirit creature tokens with flying.\nFlashback {1}{B}')
  const handCards = [
    creature('Thalia, Guardian of Thraben', '{1}{W}', 'W', 'Human Soldier', 2, 1, 'First strike\nNoncreature spells cost {1} more to cast.', ['first strike']),
    spell('Selesnya Charm', '{G}{W}', 'GW', 'Instant', 'Choose one —\n• Target creature gets +2/+2 and gains trample until end of turn.\n• Exile target creature with power 5 or greater.\n• Create a 2/2 white Knight creature token with vigilance.'),
    spell('Swords to Plowshares', '{W}', 'W', 'Instant', 'Exile target creature. Its controller gains life equal to its power.'),
    creature('Elvish Mystic', '{G}', 'G', 'Elf Druid', 1, 1, '{T}: Add {G}.'),
    basic('Forest'),
    spell('Wrenn and Six', '{R}{G}', 'RG', 'Legendary Planeswalker — Wrenn', '+1: Return up to one target land card from your graveyard to your hand.\n−1: Wrenn and Six deals 1 damage to any target.\n−7: You get an emblem with "Instants and sorceries you own in your graveyard have retrace."', { loyalty: 3 }),
  ]

  const t = buildTable([
    {
      player: player({ id: 1, name: 'You', isAI: false, life: 17, libraryCount: 41, counters: { experience: 2 }, mana: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 } }),
      battlefield: [
        basic('Forest', { tapped: true }),
        basic('Forest', { tapped: true }),
        basic('Plains'),
        basic('Forest'),
        spell('Temple Garden', '', '', 'Land — Forest Plains', '({T}: Add {G} or {W}.)\nAs Temple Garden enters the battlefield, you may pay 2 life.', { types: ['Land'] }),
        basic('Plains', { tapped: true }),
        champ,
        rancor,
        pridemate,
        apparition,
        creature('Llanowar Elves', '{G}', 'G', 'Elf Druid', 1, 1, '{T}: Add {G}.', [], { tapped: true }),
        soldier(),
        soldier(),
        creature('Thalia\'s Lieutenant', '{1}{W}', 'W', 'Human Soldier', 1, 1, 'When Thalia\'s Lieutenant enters the battlefield, put a +1/+1 counter on each other Human you control.', [], { sick: true }),
        spell('Ajani, Strength of the Pride', '{2}{W}{W}', 'W', 'Legendary Planeswalker — Ajani', '+1: You gain life equal to the number of creatures you control plus the number of planeswalkers you control.\n−2: Create a 2/2 white Cat Soldier creature token named Ajani\'s Pridemate.\n0: If you have at least 15 life more than your starting life total, exile Ajani and each artifact and creature your opponents control.', { loyalty: 5, counters: { LOYALTY: 5 } }),
        spell('Mind Stone', '{2}', '', 'Artifact', '{T}: Add {C}.\n{1}, {T}, Sacrifice Mind Stone: Draw a card.'),
        spell('Oath of Nissa', '{G}', 'G', 'Legendary Enchantment', 'When Oath of Nissa enters the battlefield, look at the top three cards of your library. You may reveal a creature, land, or planeswalker card from among them and put it into your hand.'),
      ],
      hand: handCards,
      graveyard: [spell('Lightning Helix', '{R}{W}', 'RW', 'Instant', 'Lightning Helix deals 3 damage to any target and you gain 3 life.'), flashback],
      exile: [],
    },
    {
      player: player({ id: 2, name: 'Forge AI', life: 12, poison: 2, libraryCount: 37 }),
      battlefield: [
        basic('Island'),
        basic('Island', { tapped: true }),
        basic('Swamp', { tapped: true }),
        basic('Swamp', { tapped: true }),
        basic('Island'),
        spell('Watery Grave', '', '', 'Land — Island Swamp', '({T}: Add {U} or {B}.)', { types: ['Land'] }),
        basic('Swamp'),
        creature('Murktide Regent', '{5}{U}{U}', 'U', 'Dragon', 5, 5, 'Delve\nFlying\nMurktide Regent enters the battlefield with a +1/+1 counter on it for each instant and sorcery card exiled with it.', ['flying'], { counters: { P1P1: 2 } }),
        creature('Ledger Shredder', '{1}{U}', 'U', 'Bird Advisor', 1, 3, 'Flying\nWhenever a player casts their second spell each turn, Ledger Shredder connives.', ['flying']),
        creature('Faerie Rogue', '', 'B', 'Faerie Rogue', 1, 1, 'Flying', ['flying'], { token: true }),
        creature('Faerie Rogue', '', 'B', 'Faerie Rogue', 1, 1, 'Flying', ['flying'], { token: true }),
        creature('Faerie Rogue', '', 'B', 'Faerie Rogue', 1, 1, 'Flying', ['flying'], { token: true, sick: true }),
        creature('Dauthi Voidwalker', '{B}{B}', 'B', 'Dauthi Minion', 3, 2, 'Shadow\nIf a card would be put into an opponent\'s graveyard from anywhere, instead exile it with a void counter on it.', ['deathtouch'], { tapped: true }),
        spell('Jace, the Mind Sculptor', '{2}{U}{U}', 'U', 'Legendary Planeswalker — Jace', '+2: Look at the top card of target player\'s library. You may put that card on the bottom.\n0: Draw three cards, then put two cards from your hand on top of your library.\n−1: Return target creature to its owner\'s hand.', { loyalty: 3 }),
        spell('Bitterblossom', '{1}{B}', 'B', 'Kindred Enchantment — Faerie', 'At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.'),
        spell('Phyrexian Arena', '{1}{B}{B}', 'B', 'Enchantment', 'At the beginning of your upkeep, you draw a card and you lose 1 life.'),
      ],
      hand: many(4, () => card({ name: '', hidden: true, zone: 'hand' })),
      graveyard: [spell('Counterspell', '{U}{U}', 'U', 'Instant', 'Counter target spell.'), spell('Thoughtseize', '{B}', 'B', 'Sorcery', 'Target player reveals their hand. You choose a nonland card from it. That player discards that card. You lose 2 life.')],
      exile: [exiledHarvester],
      command: [],
    },
  ])
  t.cards[go.id] = { ...go, zone: 'stack', controllerId: 2, ownerId: 2 }
  const playable = new Set([handCards[0].id, handCards[1].id, handCards[2].id, handCards[4].id, flashback.id])
  return {
    ...t,
    game: game({ turn: 7, phase: 'MAIN1', activePlayerId: 1, priorityPlayerId: 1, log: [
      { type: 'Turn', message: 'Turn 7 (You)' },
      { type: 'Land', message: 'You played Forest.' },
      { type: 'Stack', message: 'Forge AI cast Go for the Throat targeting Steel Leaf Champion.' },
    ] }),
    stack,
    combat: null,
    playable,
    selectable: none,
    highlighted: new Set([`card:${champ.id}`]),
    prompt: { playerId: 1, message: 'Forge AI cast Go for the Throat. Respond?', cardId: null },
    buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'Cancel', enabled: false }, focusOk: true },
  }
}

// ---- (b) token pod mid-combat ----------------------------------------------------------------

function tokenPod(): Partial<ForgeState> {
  const scute = (p = {}) => creature('Scute Swarm', '', 'G', 'Insect', 1, 1, 'Landfall — Whenever a land enters the battlefield under your control, create a 1/1 green Insect creature token. If you control six or more lands, create a token that\'s a copy of Scute Swarm instead.', [], { token: true, ...p })
  // 64 tokens: 22 attacking you (tapped), 3 bigger attacking your planeswalker, 3 blocked one by one, 36 at home.
  const attackers = many(22, () => scute({ tapped: true }))
  const pwAttackers = many(3, () => scute({ tapped: true, counters: { P1P1: 1 }, power: 2, toughness: 2 }))
  const blocked = many(3, () => scute({ tapped: true }))
  const home = [...many(28, () => scute()), ...many(6, () => scute({ sick: true })), ...many(2, () => scute({ counters: { P1P1: 1 }, power: 2, toughness: 2 }))]
  const lands = [
    ...many(8, (i) => basic('Forest', { tapped: i < 5 })),
    ...many(4, (i) => basic('Island', { tapped: i < 1 })),
    spell('Breeding Pool', '', '', 'Land — Forest Island', '({T}: Add {G} or {U}.)', { types: ['Land'] }),
    spell('Yavimaya Coast', '', '', 'Land', '{T}: Add {C}.\n{T}: Add {G} or {U}. Yavimaya Coast deals 1 damage to you.', { types: ['Land'] }),
  ]

  // You: a big mixed board.
  const wall = creature('Wall of Omens', '{1}{W}', 'W', 'Wall', 0, 4, 'Defender\nWhen Wall of Omens enters the battlefield, draw a card.', ['defender'])
  const baloth = creature('Thragtusk', '{4}{G}', 'G', 'Beast', 5, 3, 'When Thragtusk enters the battlefield, you gain 5 life.\nWhen Thragtusk leaves the battlefield, create a 3/3 green Beast creature token.')
  const knight = creature('Knight of Autumn', '{1}{G}{W}', 'GW', 'Dryad Knight', 2, 1, 'When Knight of Autumn enters the battlefield, choose one —\n• Put two +1/+1 counters on Knight of Autumn.\n• Destroy target artifact or enchantment.\n• You gain 4 life.', [], { counters: { P1P1: 2 }, power: 4, toughness: 3 })
  const teferi = spell('Teferi, Hero of Dominaria', '{3}{W}{U}', 'WU', 'Legendary Planeswalker — Teferi', '+1: Draw a card. At the beginning of the next end step, untap up to two lands.\n−3: Put target nonland permanent into its owner\'s library third from the top.\n−8: You get an emblem.', { loyalty: 6 })
  const eq = spell('Sword of Feast and Famine', '{3}', '', 'Artifact — Equipment', 'Equipped creature gets +2/+2 and has protection from black and from green.\nEquip {2}')
  const angel = creature('Baneslayer Angel', '{3}{W}{W}', 'W', 'Angel', 7, 7, 'Flying, first strike, lifelink, protection from Demons and from Dragons', ['flying', 'first strike', 'lifelink'])
  attach(eq, angel)
  const aura = spell('Ethereal Armor', '{W}', 'W', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control and has first strike.')
  attach(aura, angel)
  const aura2 = spell('Rancor', '{G}', 'G', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+0 and has trample.')
  attach(aura2, angel)
  const elk = creature('Tarmogoyf', '{1}{G}', 'G', 'Lhurgoyf', 4, 5, "Tarmogoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.")
  const myLands = [...many(4, () => basic('Plains')), ...many(4, (i) => basic('Forest', { tapped: i < 2 })), ...many(2, () => basic('Island'))]
  const youBf = [
    ...myLands,
    wall,
    baloth,
    knight,
    angel,
    eq,
    aura,
    aura2,
    elk,
    creature('Spirit', '', 'W', 'Spirit', 1, 1, 'Flying', ['flying'], { token: true }),
    creature('Spirit', '', 'W', 'Spirit', 1, 1, 'Flying', ['flying'], { token: true }),
    creature('Spirit', '', 'W', 'Spirit', 1, 1, 'Flying', ['flying'], { token: true }),
    creature('Restoration Angel', '{3}{W}', 'W', 'Angel', 3, 4, 'Flash\nFlying\nWhen Restoration Angel enters the battlefield, you may exile target non-Angel creature you control, then return it to the battlefield under your control.', ['flying'], { sick: true }),
    creature('Brimaz, King of Oreskos', '{1}{W}{W}', 'W', 'Cat Soldier', 3, 4, 'Vigilance\nWhenever Brimaz attacks, create a 1/1 white Cat Soldier creature token with vigilance that\'s attacking.', ['vigilance']),
    teferi,
    spell('Gideon, Ally of Zendikar', '{2}{W}{W}', 'W', 'Legendary Planeswalker — Gideon', '+1: Until end of turn, Gideon becomes a 5/5.\n0: Create a 2/2 white Knight Ally creature token.\n0: You get an emblem with "Creatures you control get +1/+1."', { loyalty: 4 }),
    spell('Oblivion Ring', '{2}{W}', 'W', 'Enchantment', 'When Oblivion Ring enters the battlefield, exile another target nonland permanent.'),
    spell('Smothering Tithe', '{3}{W}', 'W', 'Enchantment', 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.'),
    ...many(3, () => spell('Treasure', '', '', 'Token Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.', { token: true })),
  ]

  const t = buildTable([
    {
      player: player({ id: 1, name: 'You', isAI: false, life: 14, libraryCount: 29 }),
      battlefield: youBf,
      hand: [
        spell('Settle the Wreckage', '{2}{W}{W}', 'W', 'Instant', 'Exile all attacking creatures target player controls. That player may search their library for that many basic land cards, put those cards onto the battlefield tapped, then shuffle.'),
        spell('Path to Exile', '{W}', 'W', 'Instant', 'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.'),
        basic('Plains'),
      ],
      graveyard: [spell('Wrath of God', '{2}{W}{W}', 'W', 'Sorcery', "Destroy all creatures. They can't be regenerated.")],
    },
    {
      player: player({ id: 2, name: 'Swarm AI', life: 31, libraryCount: 22, counters: { energy: 3 } }),
      battlefield: [...lands, ...attackers, ...pwAttackers, ...blocked, ...home],
      hand: many(2, () => card({ name: '', hidden: true, zone: 'hand' })),
      graveyard: [spell('Evolving Wilds', '', '', 'Land', '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', { types: ['Land'] })],
    },
  ])
  const combat: CombatDto = {
    bands: [
      ...attackers.map((a) => ({ attackerIds: [a.id], defender: { kind: 'player' as const, id: 1 }, blockerIds: [], plannedBlockerIds: [] })),
      ...pwAttackers.map((a) => ({ attackerIds: [a.id], defender: { kind: 'card' as const, id: teferi.id }, blockerIds: [], plannedBlockerIds: [] })),
      { attackerIds: [blocked[0].id], defender: { kind: 'player', id: 1 }, blockerIds: [], plannedBlockerIds: [wall.id] },
      { attackerIds: [blocked[1].id], defender: { kind: 'player', id: 1 }, blockerIds: [], plannedBlockerIds: [baloth.id] },
      { attackerIds: [blocked[2].id], defender: { kind: 'player', id: 1 }, blockerIds: [], plannedBlockerIds: [knight.id] },
    ],
  }
  const blockable = youBf.filter((c) => c.types.includes('Creature') && !c.tapped && ![wall.id, baloth.id, knight.id].includes(c.id)).map((c) => c.id)
  return {
    ...t,
    game: game({ turn: 12, phase: 'COMBAT_DECLARE_BLOCKERS', activePlayerId: 2, priorityPlayerId: 1, log: [
      { type: 'Turn', message: 'Turn 12 (Swarm AI)' },
      { type: 'Combat', message: 'Swarm AI attacks You with 25 creatures and Teferi, Hero of Dominaria with 3 creatures.' },
    ] }),
    stack: [],
    combat,
    playable: new Set(),
    selectable: { cardIds: new Set(blockable), min: 0, max: 99 },
    highlighted: new Set(),
    prompt: { playerId: 1, message: 'Declare blockers: choose creatures to block with', cardId: null },
    buttons: { ok: { label: 'Done', enabled: true }, cancel: { label: 'Reset', enabled: true }, focusOk: true },
  }
}

// ---- (c) four players ------------------------------------------------------------------------

function fourPlayer(): Partial<ForgeState> {
  const commander = (name: string, cost: string, colors: string, sub: string, p: number, t: number, text: string, kw: string[] = []) =>
    creature(name, cost, colors, sub, p, t, text, kw, { commander: true })
  const atraxa = commander('Atraxa, Praetors\' Voice', '{G}{W}{U}{B}', 'WUBG', 'Phyrexian Angel Horror', 4, 4, 'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.', ['flying', 'vigilance', 'deathtouch', 'lifelink'])
  const krenko = commander('Krenko, Mob Boss', '{2}{R}{R}', 'R', 'Goblin Warrior', 3, 3, '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.')
  const goblins = many(9, () => creature('Goblin', '', 'R', 'Goblin', 1, 1, '', [], { token: true, tapped: true }))
  const ur = commander('Urza, Lord High Artificer', '{2}{U}{U}', 'U', 'Human Artificer', 1, 4, 'When Urza enters the battlefield, create a 0/0 colorless Construct artifact creature token.')
  const swords = spell('Swords to Plowshares', '{W}', 'W', 'Instant', 'Exile target creature. Its controller gains life equal to its power.')
  const meCmd = commander('Kenrith, the Returned King', '{4}{W}', 'W', 'Human Noble', 5, 5, '{R}: All creatures gain trample and haste until end of turn.\n{1}{G}: Put a +1/+1 counter on target creature.')

  const t = buildTable([
    {
      player: player({ id: 1, name: 'You', isAI: false, life: 32, libraryCount: 71 }),
      battlefield: [
        ...many(3, () => basic('Plains')),
        ...many(2, (i) => basic('Forest', { tapped: i === 0 })),
        spell('Command Tower', '', '', 'Land', '{T}: Add one mana of any color in your commander\'s color identity.', { types: ['Land'] }),
        spell('Sol Ring', '{1}', '', 'Artifact', '{T}: Add {C}{C}.'),
        creature('Selfless Spirit', '{1}{W}', 'W', 'Spirit', 2, 1, 'Flying\nSacrifice Selfless Spirit: Creatures you control gain indestructible until end of turn.', ['flying']),
        creature('Knight Ally', '', 'W', 'Knight Ally', 2, 2, '', [], { token: true }),
        creature('Knight Ally', '', 'W', 'Knight Ally', 2, 2, '', [], { token: true }),
      ],
      hand: [swords, basic('Forest'), creature('Avenger of Zendikar', '{5}{G}{G}', 'G', 'Elemental', 5, 5, 'When Avenger of Zendikar enters the battlefield, create a 0/1 green Plant creature token for each land you control.')],
      command: [meCmd],
    },
    {
      player: player({ id: 2, name: 'Atraxa AI', life: 27, poison: 4, libraryCount: 64, counters: { experience: 3 } }),
      battlefield: [...many(4, () => basic('Island')), ...many(3, () => basic('Swamp')), atraxa, spell('Smothering Tithe', '{3}{W}', 'W', 'Enchantment', 'Whenever an opponent draws a card, that player may pay {2}.')],
      hand: many(5, () => card({ name: '', hidden: true, zone: 'hand' })),
    },
    {
      player: player({ id: 3, name: 'Urza AI', life: 35, libraryCount: 70 }),
      battlefield: [...many(6, () => basic('Island')), ur, creature('Construct', '', '', 'Construct', 4, 4, 'This creature gets +1/+1 for each artifact you control.', [], { token: true, types: ['Artifact', 'Creature'], typeLine: 'Token Artifact Creature — Construct' }), spell('Sol Ring', '{1}', '', 'Artifact', '{T}: Add {C}{C}.')],
      hand: many(6, () => card({ name: '', hidden: true, zone: 'hand' })),
    },
    {
      player: player({ id: 4, name: 'Krenko AI', life: 18, libraryCount: 66 }),
      battlefield: [...many(5, (i) => basic('Mountain', { tapped: i < 3 })), krenko, ...goblins, ...many(4, () => creature('Goblin', '', 'R', 'Goblin', 1, 1, '', [], { token: true, sick: true })), spell('Impact Tremors', '{1}{R}', 'R', 'Enchantment', 'Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.')],
      hand: many(3, () => card({ name: '', hidden: true, zone: 'hand' })),
    },
  ])
  const combat: CombatDto = { bands: goblins.map((g) => ({ attackerIds: [g.id], defender: { kind: 'player' as const, id: 1 }, blockerIds: [], plannedBlockerIds: [] })) }
  return {
    ...t,
    game: game({ turn: 9, phase: 'COMBAT_DECLARE_ATTACKERS', activePlayerId: 4, priorityPlayerId: 1, log: [{ type: 'Combat', message: 'Krenko AI attacks You with 9 creatures.' }] }),
    stack: [],
    combat,
    playable: new Set([swords.id]),
    selectable: none,
    highlighted: new Set(),
    prompt: { playerId: 1, message: 'Krenko AI is attacking. Respond?', cardId: null },
    buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'Cancel', enabled: false }, focusOk: true },
  }
}

export const FIXTURES: Fixture[] = [
  { id: 'quiet', label: 'Mid-game', state: quiet },
  { id: 'pod', label: 'Token pod · combat', state: tokenPod },
  { id: 'four', label: '4 players', state: fourPlayer },
]
