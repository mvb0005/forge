import { landSym } from '../look/ManaRibbon'
import type { Sym } from '../look/mana'
import type { CardDto } from '../protocol'

const isPlainLand = (c: CardDto) => c.types.includes('Land') && !c.types.includes('Creature') && c.attachedToId == null

export const isRock = (c: CardDto) => !c.types.includes('Land') && c.types.includes('Artifact') && /\{T\}[^.:]*: Add \{/.test(c.text)

export function rockSym(c: CardDto) {
  const m = c.text.match(/\{T\}[^.:]*: Add \{([^}]+)\}/)
  const s = (m?.[1] ?? 'C').toUpperCase()
  const count = c.text.match(/: Add ((?:\{C\})+)/)?.[1].length
  return count && count > 3 ? String(count / 3) : s
}

/** A land you will want to find by name: it has an activated ability that does more than add mana (a fetch, a manland). */
const hasUse = (text: string) => text.split('\n').some((l) => /^[^"]*\}[^:"]*: (?!Add )/.test(l))

/** One stack in the land tray: lands that make the same mana, or one named land or rock. */
export type TrayGroup = { key: string; sym: Sym; name: string | null; open: number[]; tapped: number[] }

/**
 * The land tray's stacks. Lands stack by the mana they make (an enters-tapped dual is a W/G stack); a land
 * with an activated ability, and a mana rock, keep their name (identical copies still stack). Presentation only.
 */
export function trayGroups(cards: CardDto[]): TrayGroup[] {
  const by = new Map<string, TrayGroup>()
  for (const c of cards) {
    let key: string
    let sym: Sym
    let name: string | null = null
    if (isPlainLand(c)) {
      const s = landSym(c)
      const used = hasUse(c.text)
      sym = s.sym
      name = used ? c.name : (s.label ?? null)
      key = used ? `n:${c.name}` : `s:${sym}:${name ?? ''}`
    } else if (isRock(c)) {
      sym = rockSym(c)
      name = c.name
      key = `n:${c.name}`
    } else continue
    const g = by.get(key) ?? { key, sym, name, open: [], tapped: [] }
    ;(c.tapped ? g.tapped : g.open).push(c.id)
    by.set(key, g)
  }
  const order = 'WUBRGC'
  const rank = (g: TrayGroup) => (g.key.startsWith('s:') ? 0 : 1)
  return [...by.values()].sort((a, b) => rank(a) - rank(b) || (order.indexOf(a.sym[0]) + 7) % 7 - (order.indexOf(b.sym[0]) + 7) % 7 || (a.name ?? '').localeCompare(b.name ?? ''))
}

/** The cards a land shelf is made of: lands and mana rocks. */
export const isShelfCard = (c: CardDto) => c.types.includes('Land') || isRock(c)

/**
 * The land shelf at the right end of a battlefield: the open-mana count in a header column, then the
 * stacks in columns of as many rows as fit, top to bottom. A column with a named stack (a rock, a fetch) is wider.
 */
export const SHELF = { pad: 6, head: 44, rowH: 28, gap: 3, colGap: 8, cellW: 58, namedW: 118 }
/** Room kept clear around a shelf: from the battlefield's cards on its left, and from the field's edge on its right. */
export const SHELF_GAP = 10
export const SHELF_INSET = 4

export const shelfRows = (h: number) => Math.max(1, Math.floor((h - 2 * SHELF.pad + SHELF.gap) / (SHELF.rowH + SHELF.gap)))

/** Width of each column of stacks on a shelf this tall. */
export function shelfColumns(groups: TrayGroup[], h: number): number[] {
  const rows = shelfRows(h)
  const cols: number[] = []
  groups.forEach((g, i) => {
    const c = Math.floor(i / rows)
    cols[c] = Math.max(cols[c] ?? 0, g.name ? SHELF.namedW : SHELF.cellW)
  })
  return cols
}

export function shelfWidth(groups: TrayGroup[], h: number) {
  const cols = shelfColumns(groups, h)
  if (!cols.length) return 0
  return SHELF_GAP + 2 * SHELF.pad + SHELF.head + cols.reduce((a, w) => a + w + SHELF.colGap, 0) + SHELF_INSET
}
