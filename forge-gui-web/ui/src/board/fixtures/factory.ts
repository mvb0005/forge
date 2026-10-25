import type { CardDto, PlayerDto } from '../../protocol'

let nextId = 1000

export function card(p: Partial<CardDto> & { name: string }): CardDto {
  return {
    id: p.id ?? nextId++,
    zone: 'battlefield',
    ownerId: 1,
    controllerId: p.ownerId ?? 1,
    hidden: false,
    img: null,
    backImg: null,
    manaCost: '',
    colors: '',
    typeLine: '',
    types: [],
    text: '',
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    damage: 0,
    counters: {},
    keywords: [],
    tapped: false,
    sick: false,
    phasedOut: false,
    faceDown: false,
    token: false,
    attachedToId: null,
    attachedToPlayerId: null,
    attachmentIds: [],
    exiledWithId: null,
    heldExileIds: [],
    commander: false,
    sprocket: null,
    ...p,
  }
}

export function player(p: Partial<PlayerDto> & { id: number; name: string }): PlayerDto {
  return {
    isAI: true,
    life: 20,
    poison: 0,
    counters: {},
    mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    handCount: 0,
    libraryCount: 40,
    zones: { hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
    avatarImg: null,
    hasLost: false,
    ...p,
  }
}

const basicText: Record<string, string> = {
  Plains: '({T}: Add {W}.)',
  Island: '({T}: Add {U}.)',
  Swamp: '({T}: Add {B}.)',
  Mountain: '({T}: Add {R}.)',
  Forest: '({T}: Add {G}.)',
}

export const basic = (name: keyof typeof basicText, p: Partial<CardDto> = {}) =>
  card({ name, typeLine: `Basic Land — ${name}`, types: ['Land'], text: basicText[name], ...p })

export type Seat = {
  player: PlayerDto
  battlefield?: CardDto[]
  hand?: CardDto[]
  graveyard?: CardDto[]
  exile?: CardDto[]
  command?: CardDto[]
}

/** Assigns zones/controllers and builds the store's players/cards maps. */
export function buildTable(seats: Seat[]) {
  const players: Record<number, PlayerDto> = {}
  const cards: Record<number, CardDto> = {}
  for (const s of seats) {
    const zones = { hand: [] as number[], battlefield: [] as number[], graveyard: [] as number[], exile: [] as number[], command: [] as number[] }
    for (const zone of ['battlefield', 'hand', 'graveyard', 'exile', 'command'] as const) {
      for (const c of s[zone] ?? []) {
        c.zone = zone
        c.controllerId = s.player.id
        if (c.ownerId === 1 && s.player.id !== 1) c.ownerId = s.player.id
        cards[c.id] = c
        zones[zone].push(c.id)
      }
    }
    players[s.player.id] = { ...s.player, zones, handCount: zones.hand.length }
  }
  return { players, cards }
}

export function attach(aura: CardDto, host: CardDto) {
  aura.attachedToId = host.id
  host.attachmentIds = [...host.attachmentIds, aura.id]
}

export function holdInExile(host: CardDto, exiled: CardDto) {
  exiled.exiledWithId = host.id
  host.heldExileIds = [...host.heldExileIds, exiled.id]
}

export const creature = (
  name: string,
  manaCost: string,
  colors: string,
  sub: string,
  power: number,
  toughness: number,
  text = '',
  keywords: string[] = [],
  p: Partial<CardDto> = {},
) => card({ name, manaCost, colors, typeLine: `Creature — ${sub}`, types: ['Creature'], power, toughness, text, keywords, ...p })

export const spell = (name: string, manaCost: string, colors: string, typeLine: string, text: string, p: Partial<CardDto> = {}) =>
  card({ name, manaCost, colors, typeLine, types: typeLine.split(' — ')[0].split(' ').filter((t) => t !== 'Legendary' && t !== 'Basic' && t !== 'Snow'), text, ...p })

export const many = (n: number, f: (i: number) => CardDto) => Array.from({ length: n }, (_, i) => f(i))
