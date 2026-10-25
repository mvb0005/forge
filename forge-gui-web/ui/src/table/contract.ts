import type { CardDto, CombatDto, GameDto, PlayerDto } from '../protocol'

// The card layer (docs/PLAN.md, "One card layer"). Every visible card is one element keyed by id;
// a layout function per table mode says where each card goes. Moving between rows, zones or modes
// is the same element animating, so nothing else may position cards.

export type TableMode = 'main' | 'combat' | 'fanout'

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
}

// Named rectangles the chrome lays out around (type line, seat plaques, zone rails, lanes).
export type Region = { x: number; y: number; w: number; h: number }

export type LayoutInput = {
  mode: TableMode
  viewport: { w: number; h: number }
  meId: number
  focusId: number | null // opponent drawn full size (multiplayer)
  game: GameDto
  players: Record<number, PlayerDto>
  cards: Record<number, CardDto>
  combat: CombatDto | null
  highlighted: Set<string>
}

export type LayoutResult = {
  placements: Map<number, Placement>
  regions: Record<string, Region>
}

// Pure: same input, same output, no DOM reads. Unit-tested against fixtures and bench boards.
export type LayoutFn = (input: LayoutInput) => LayoutResult
