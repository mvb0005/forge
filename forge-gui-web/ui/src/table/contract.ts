import type { CardDto, CombatDto, GameDto, PlayerDto, StackItemDto } from '../protocol'

// The card layer (docs/PLAN.md, "One card layer"). Every visible card is one element keyed by id;
// a layout function per table mode says where each card goes. Moving between rows, zones or modes
// is the same element animating, so nothing else may position cards.

export type TableMode = 'main' | 'combat' | 'fanout'

// Where a placed card sits, which decides how it is drawn and what a click does.
// 'zone' = a face-down anchor at a pile or hand count (invisible; it lets cards fly to and from it).
// 'command' = your commander, face up in its slot in the command zone.
export type PlacementKind = 'field' | 'attach' | 'hand' | 'stack' | 'zone' | 'command'

export type Placement = {
  x: number // px, top-left of the card's untapped footprint, relative to the table
  y: number
  w: number // card width; height is w * CARD_RATIO
  rot: number // degrees; 90 = tapped
  z: number
  opacity?: number // default 1
  scale?: number // default 1
  count?: number // > 1: this element stands for a group of identical cards (×N badge)
  memberIds?: number[] // the other ids in the group; they get no element of their own
  kind: PlacementKind
  edge?: 'top' | 'bottom' // battlefield side: which edge faces the centre line
  faceId?: number // card drawn on the element when it isn't the keyed card (mixed land piles)
  label?: string // small centred caption ("2 tapped")
  more?: number // attachments not drawn (+N on the last one shown)
  pile?: boolean // land pile with several kinds of copies: hovering opens it
}

// Named rectangles the chrome lays out around (type line, seat plaques, zone rails, lanes).
export type Region = { x: number; y: number; w: number; h: number }

export type LayoutInput = {
  mode: TableMode
  viewport: { w: number; h: number }
  meId: number
  focusId: number | null // the opponent a duel draws full size. A multiplayer table draws every opponent.
  game: GameDto
  players: Record<number, PlayerDto>
  cards: Record<number, CardDto>
  combat: CombatDto | null
  highlighted: Set<string>
  stack: StackItemDto[]
  selectable?: Set<number> // card ids you may choose now (lands unfold from the ribbon when one is)
  handOrder?: number[] | null // your arranged hand; absent means mana-value order
}

export type LayoutResult = {
  placements: Map<number, Placement>
  regions: Record<string, Region>
}

// Pure: same input, same output, no DOM reads. Unit-tested against fixtures and bench boards.
export type LayoutFn = (input: LayoutInput) => LayoutResult
