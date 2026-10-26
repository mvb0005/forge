import type { CardDto } from '../protocol'

export type ManaLetter = 'W' | 'U' | 'B' | 'R' | 'G'
export const WUBRG: ManaLetter[] = ['W', 'U', 'B', 'R', 'G']

/** Colour letters in WUBRG order, deduped; anything else (C, M, junk) dropped. */
export function identity(colors: string | Iterable<string>): ManaLetter[] {
  const s = new Set([...colors].map((c) => c.toUpperCase()))
  return WUBRG.filter((c) => s.has(c))
}

/**
 * Q-01 band rule. Colourless gets the neutral tone. One colour is flat. Two or more split the half
 * into equal bands in WUBRG order (like the v2 land washes, side by side), each band flat, with a
 * short soft seam (SEAM % of the width) so the bands read as one table, not stripes.
 */
export const SEAM = 6

export function toneStops(colors: string | Iterable<string>, hi = false): string {
  const id = identity(colors)
  const v = (c: string) => `var(--lk-tone-${c.toLowerCase()}${hi ? '-hi' : ''})`
  if (id.length === 0) return v('C')
  if (id.length === 1) return v(id[0])
  const band = 100 / id.length
  const half = SEAM / 2
  const stops = id.flatMap((c, i) => {
    const a = i === 0 ? 0 : i * band + half
    const b = i === id.length - 1 ? 100 : (i + 1) * band - half
    return [`${v(c)} ${+a.toFixed(2)}%`, `${v(c)} ${+b.toFixed(2)}%`]
  })
  return stops.join(', ')
}

export function toneBackground(colors: string | Iterable<string>, hi = false): string {
  const id = identity(colors)
  return id.length < 2 ? toneStops(colors, hi) : `linear-gradient(90deg, ${toneStops(colors, hi)})`
}

const BASIC: Record<string, ManaLetter> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }

/**
 * Fallback colour identity from the battlefield when PlayerDto.colorIdentity is absent (before the
 * first decision point, or an older server): basic land types, then the permanents' colours.
 */
export function boardIdentity(cards: CardDto[]): ManaLetter[] {
  const lands = new Set<string>()
  const other = new Set<string>()
  for (const c of cards) {
    if (c.types.includes('Land')) for (const [b, l] of Object.entries(BASIC)) { if (c.typeLine.includes(b)) lands.add(l) }
    for (const ch of c.colors) other.add(ch)
  }
  return identity(lands.size ? lands : other)
}
