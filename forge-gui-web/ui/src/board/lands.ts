import { landSym } from '../look/ManaRibbon'
import type { CardDto } from '../protocol'

export type LandChip = {
  key: string
  name: string
  ids: number[]
  tapped: number
  sym: string
  ability: string | null
}

/** Text worth reading on a land: the tap-for-mana line is already the pip, so it is left out. */
export function landAbility(text: string): string | null {
  const stripped = text
    .replace(/\(\{T\}: Add [^)]*\)\.?/gi, '')
    .replace(/\{T\}: Add \{[WUBRGC]\}(?: or \{[WUBRGC]\})*\.?/gi, '')
    .replace(/\{T\}: Add one mana of any colou?r in your commander's color identity\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!stripped) return null
  const line = stripped.split('\n')[0].trim()
  return line.length > 84 ? `${line.slice(0, 82)}…` : line
}

const isPlainLand = (c: CardDto) => c.types.includes('Land') && !c.types.includes('Creature') && c.attachedToId == null

/** Lands as chips. Basics of one name stack. A land with an ability keeps that line, and identical copies still stack. */
export function landChips(cards: CardDto[]): LandChip[] {
  const by = new Map<string, LandChip>()
  for (const c of cards) {
    if (!isPlainLand(c)) continue
    const ability = landAbility(c.text)
    const { sym } = landSym(c)
    const key = ability ? `${c.name}\0${ability}` : c.name
    const chip = by.get(key) ?? { key, name: c.name, ids: [], tapped: 0, sym, ability }
    chip.ids.push(c.id)
    if (c.tapped) chip.tapped++
    by.set(key, chip)
  }
  const order = 'WUBRGC'
  return [...by.values()].sort((a, b) => {
    if (!!a.ability !== !!b.ability) return a.ability ? 1 : -1
    return order.indexOf(a.sym[0] ?? 'C') - order.indexOf(b.sym[0] ?? 'C') || a.name.localeCompare(b.name)
  })
}
