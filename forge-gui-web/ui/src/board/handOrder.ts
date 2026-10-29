import { cmc } from '../look/mana'
import type { CardDto } from '../protocol'

function cmp(a: CardDto | undefined, b: CardDto | undefined, ai: number, bi: number) {
  const d = cmc(a?.manaCost) - cmc(b?.manaCost)
  if (d) return d
  const n = (a?.name ?? '').localeCompare(b?.name ?? '')
  return n || ai - bi
}

/**
 * Hand order for the table. With no arrangement yet, mana value then name.
 * An arrangement is kept; a card that just arrived is inserted at its mana-value place.
 */
export function orderedHand(ids: number[], cards: Record<number, CardDto>, custom: number[] | null): number[] {
  const by = (a: number, b: number) => cmp(cards[a], cards[b], a, b)
  if (!custom?.length) return [...ids].sort(by)
  const have = new Set(ids)
  const kept = custom.filter((id) => have.has(id))
  const fresh = ids.filter((id) => !kept.includes(id)).sort(by)
  for (const id of fresh) {
    const at = kept.findIndex((p) => cmp(cards[id], cards[p], id, p) < 0)
    kept.splice(at < 0 ? kept.length : at, 0, id)
  }
  return kept
}
