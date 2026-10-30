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
