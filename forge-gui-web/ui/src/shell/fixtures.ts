import type { Ask, CardDto, GameDto, PlayerDto, ServerMessage } from '../protocol'

// Dev-only data for /?dialogs. Never imported by the real app path.
const card = (id: number, name: string, o: Partial<CardDto> = {}): CardDto => ({
  id, zone: 'battlefield', ownerId: 1, controllerId: 1, hidden: false, name,
  img: null, backImg: null, manaCost: '', colors: '', typeLine: 'Creature', types: ['Creature'], text: '',
  power: null, toughness: null, loyalty: null, defense: null, damage: 0, counters: {}, keywords: [],
  tapped: false, sick: false, phasedOut: false, faceDown: false, token: false, attachedToId: null,
  attachedToPlayerId: null, attachmentIds: [], exiledWithId: null, heldExileIds: [], commander: false, sprocket: null,
  ...o,
})

const creature = (id: number, name: string, p: number, t: number, o: Partial<CardDto> = {}) =>
  card(id, name, { power: p, toughness: t, typeLine: 'Creature', ...o })

export const cards: CardDto[] = [
  creature(10, 'Colossal Dreadmaw', 6, 6, { manaCost: '{4}{G}{G}', colors: 'G', keywords: ['trample'], typeLine: 'Creature — Dinosaur', text: 'Trample' }),
  creature(11, 'Llanowar Elves', 1, 1, { controllerId: 2, ownerId: 2, manaCost: '{G}', colors: 'G' }),
  creature(12, 'Serra Angel', 4, 4, { controllerId: 2, ownerId: 2, damage: 1, keywords: ['flying', 'vigilance'], colors: 'W', manaCost: '{3}{W}{W}' }),
  creature(13, 'Grizzly Bears', 2, 2, { controllerId: 2, ownerId: 2, colors: 'G', manaCost: '{1}{G}' }),
  card(20, 'Lightning Bolt', { zone: 'library', types: ['Instant'], typeLine: 'Instant', colors: 'R', manaCost: '{R}', text: 'Lightning Bolt deals 3 damage to any target.' }),
  card(21, 'Island', { zone: 'library', types: ['Land'], typeLine: 'Basic Land — Island' }),
  card(22, 'Counterspell', { zone: 'library', types: ['Instant'], typeLine: 'Instant', colors: 'U', manaCost: '{U}{U}' }),
  card(23, 'Forest', { zone: 'library', types: ['Land'], typeLine: 'Basic Land — Forest' }),
  card(24, 'Opt', { zone: 'library', types: ['Instant'], typeLine: 'Instant', colors: 'U', manaCost: '{U}' }),
  card(25, 'Mountain', { zone: 'library', types: ['Land'], typeLine: 'Basic Land — Mountain' }),
  card(30, 'Birds of Paradise', { types: ['Creature'], power: 0, toughness: 1, colors: 'G', manaCost: '{G}', text: 'Flying\n{T}: Add one mana of any color.' }),
  card(31, 'Soul Warden', { zone: 'hand', power: 1, toughness: 1, colors: 'W' }),
  card(32, 'Elvish Visionary', { zone: 'hand', power: 1, toughness: 1, colors: 'G' }),
  card(33, 'Wall of Omens', { zone: 'hand', power: 0, toughness: 4, colors: 'W' }),
]

const player = (id: number, name: string, isAI: boolean, o: Partial<PlayerDto> = {}): PlayerDto => ({
  id, name, isAI, life: 20, poison: 0, counters: {}, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  handCount: 3, libraryCount: 40, zones: { hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
  avatarImg: null, hasLost: false, ...o,
})

const game0: GameDto = {
    turn: 5, phase: 'MAIN1', activePlayerId: 1, priorityPlayerId: 1, localPlayerIds: [1], gameOver: false, winner: null,
    log: [
      { type: 'TURN', message: 'Turn 5 (You)' },
      { type: 'LAND', message: 'You played Forest.' },
      { type: 'STACK_RESOLVE', message: 'Llanowar Elves resolves.' },
      { type: 'DAMAGE', message: 'Serra Angel deals 4 damage to you.' },
    ],
  }

export const setup: ServerMessage[] = [
  {
    t: 'state', seq: 1, full: true,
    game: game0,
    players: [
      player(1, 'You', false, { mana: { W: 0, U: 1, B: 0, R: 0, G: 2, C: 1 } }),
      player(2, 'Forge AI', true, { life: 14 }),
    ],
    cards,
  },
  { t: 'prompt', playerId: 1, message: 'Play a spell or ability, or pass priority.', cardId: null },
  { t: 'buttons', playerId: 1, ok: { label: 'Pass priority', enabled: true }, cancel: { label: 'End turn', enabled: true }, focusOk: true },
]

const items = (labels: string[]) => labels.map((label, i) => ({ i, label, ref: null }))
const cardItems = (ids: number[]) => ids.map((id, i) => ({ i, label: cards.find((c) => c.id === id)!.name, ref: { kind: 'card' as const, id } }))

let id = 100
type Body<T> = T extends unknown ? Omit<T, 't' | 'id'> : never
type AskBody = Body<Ask>
const a = (x: AskBody): Ask => ({ t: 'ask', id: ++id, ...x }) as Ask

export const asks: { name: string; make: () => Ask }[] = [
  { name: 'confirm (card)', make: () => a({ kind: 'confirm', title: 'Optional trigger', message: 'Use Soul Warden\'s ability? You gain 1 life.', cardId: 31, options: ['Yes', 'No'], defaultIndex: 0 }) },
  { name: 'option', make: () => a({ kind: 'option', title: 'Mulligan', message: 'You have 7 cards in hand. Keep this hand?', options: ['Keep', 'Mulligan'], defaultIndex: 0 }) },
  { name: 'option (many)', make: () => a({ kind: 'option', title: 'Choose a mode', message: 'Choose one —', options: ['Counter target spell', 'Return target creature to its owner\'s hand', 'Draw a card', 'Tap target creature'], defaultIndex: 2 }) },
  { name: 'input (text)', make: () => a({ kind: 'input', title: 'Name a card', message: 'Choose a card name', initial: '', options: ['Lightning Bolt', 'Counterspell', 'Llanowar Elves'], numeric: false }) },
  { name: 'input (numeric)', make: () => a({ kind: 'input', title: 'Choose X', message: 'Announce the value of X', initial: '3', options: null, numeric: true }) },
  { name: 'choose single (text)', make: () => a({ kind: 'choose', title: 'Choose a color', message: 'Choose a color for Birds of Paradise', min: 1, max: 1, items: items(['White', 'Blue', 'Black', 'Red', 'Green']), selected: [] }) },
  { name: 'choose single (cards)', make: () => a({ kind: 'choose', title: 'Choose target creature', message: 'Lightning Bolt deals 3 damage to any target', min: 1, max: 1, items: cardItems([11, 12, 13]), selected: [] }) },
  { name: 'choose optional (0..1)', make: () => a({ kind: 'choose', title: 'Search your library', message: 'You may put a basic land card into your hand', min: 0, max: 1, items: cardItems([21, 23, 25]), selected: [] }) },
  { name: 'library search (up to 2)', make: () => a({ kind: 'choose', title: 'Search your library', message: 'Search for up to two cards', min: 0, max: 2, items: cardItems([20, 21, 22, 23, 24, 25]), selected: [] }) },
  { name: 'choose multi (1..2)', make: () => a({ kind: 'choose', title: 'Discard', message: 'Discard up to two cards, at least one', min: 1, max: 2, items: cardItems([31, 32, 33, 20]), selected: [1] }) },
  { name: 'choose many (0..all)', make: () => a({ kind: 'choose', title: 'Choose any number', message: 'Choose creatures to untap', min: 0, max: 99, items: cardItems([10, 11, 12, 13, 30]), selected: [] }) },
  { name: 'choose players', make: () => a({ kind: 'choose', title: 'Choose a player', message: 'Target player draws two cards', min: 1, max: 1, items: [{ i: 0, label: 'You', ref: { kind: 'player', id: 1 } }, { i: 1, label: 'Forge AI', ref: { kind: 'player', id: 2 } }], selected: [] }) },
  { name: 'order (plain)', make: () => a({ kind: 'order', title: 'Order triggers', message: 'Put your simultaneous triggers on the stack (first resolves last)', min: 3, max: 3, items: items(['Soul Warden: gain 1 life', 'Elvish Visionary: draw a card', 'Wall of Omens: draw a card']), cardId: null }) },
  { name: 'order (pick 2)', make: () => a({ kind: 'order', title: 'Pick and order', message: 'Put two cards on top of your library in any order', min: 2, max: 2, items: cardItems([20, 21, 22, 23]), cardId: 30 }) },
  { name: 'ability', make: () => a({ kind: 'ability', cardId: 30, items: [{ i: 0, label: 'Cast Birds of Paradise', ref: null, enabled: false }, { i: 1, label: '{T}: Add {W}.', ref: null, enabled: true }, { i: 2, label: '{T}: Add {G}.', ref: null, enabled: true }, { i: 3, label: '{T}: Add one mana of any color.', ref: null, enabled: true }] }) },
  { name: 'damage (trample)', make: () => a({ kind: 'damage', attackerId: 10, blockerIds: [12, 13], damage: 6, defender: { kind: 'player', id: 2 }, overrideOrder: true, maySkip: false }) },
  { name: 'damage (no trample)', make: () => a({ kind: 'damage', attackerId: 10, blockerIds: [11, 13], damage: 6, defender: null, overrideOrder: false, maySkip: true }) },
  { name: 'amount', make: () => a({ kind: 'amount', sourceCardId: 20, amount: 5, atLeastOne: true, label: 'Distribute damage', items: cardItems([11, 12, 13]) }) },
  { name: 'arrange (scry)', make: () => a({ kind: 'arrange', title: 'Scry 3', cardIds: [20, 21, 22], manipulableIds: [20, 21, 22], toTop: true, toBottom: true, toAnywhere: false }) },
  { name: 'arrange (anywhere)', make: () => a({ kind: 'arrange', title: 'Rearrange the top of your library', cardIds: [20, 21, 22, 23, 24], manipulableIds: [21, 23], toTop: true, toBottom: true, toAnywhere: true }) },
  { name: 'arrange (top only)', make: () => a({ kind: 'arrange', title: 'Put cards on top', cardIds: [24, 25, 20, 21], manipulableIds: [24, 25], toTop: true, toBottom: false, toAnywhere: false }) },
]

export const extras: { name: string; msgs: () => ServerMessage[] }[] = [
  { name: 'reveal', msgs: () => [{ t: 'reveal', title: 'Forge AI reveals their hand', cardIds: [20, 22, 24, 21] }] },
  { name: 'notice info', msgs: () => [{ t: 'notice', level: 'info', title: 'Forge AI', message: 'Forge AI cast Counterspell targeting Lightning Bolt.' }] },
  { name: 'notice error', msgs: () => [{ t: 'error', message: 'Could not start match: deck not found' }] },
  { name: 'notice flash', msgs: () => [{ t: 'notice', level: 'flash', title: '', message: 'That card is not a valid choice.' }] },
  { name: 'opponent combat', msgs: () => [{ t: 'state', seq: 2, full: false, game: { ...game0, phase: 'COMBAT_DECLARE_BLOCKERS', activePlayerId: 2, priorityPlayerId: 2 } }, { t: 'prompt', playerId: 1, message: 'Declare blockers.', cardId: null }, { t: 'buttons', playerId: 1, ok: { label: 'OK', enabled: false }, cancel: { label: '', enabled: false }, focusOk: true }] },
  { name: 'reset table', msgs: () => setup },
  { name: 'game over', msgs: () => [{ t: 'gameOver', winner: 'You', summary: 'Forge AI lost: life total reached 0.\nTurn 9, 14 minutes.' }] },
  { name: 'ended (joined late)', msgs: () => [{ t: 'ended', summary: 'Forge AI won on turn 9' }] },
]
