import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../board/fixtures'
import type { CardDto } from '../protocol'
import type { ForgeState } from '../store'
import type { LayoutInput, Placement } from './contract'
import { LAYOUTS, tableMode } from './layouts'

// Your hand at any size: every card it draws sits inside the hand row, each shows at least the start of its
// name, a big hand lies flat, and a hand too big for that shows a window that scrolls.

function withHand(id: string, n: number): Partial<ForgeState> {
  const s = FIXTURES.find((f) => f.id === id)!.state()
  const meId = s.game!.localPlayerIds[0]
  const me = s.players![meId]
  const model = s.cards![me.zones.hand[0]]
  const cards: Record<number, CardDto> = { ...s.cards }
  const ids = Array.from({ length: n }, (_, i) => {
    cards[900000 + i] = { ...model, id: 900000 + i, name: `Card ${i}`, manaCost: `{${i % 8}}` }
    return 900000 + i
  })
  return { ...s, cards, players: { ...s.players, [meId]: { ...me, handCount: n, zones: { ...me.zones, hand: ids } } } }
}

function layout(s: Partial<ForgeState>, view: { w: number; h: number }, handStart = 0) {
  const meId = s.game!.localPlayerIds[0]
  const i: LayoutInput = {
    mode: tableMode(null), viewport: view, meId, focusId: null, game: s.game!, players: s.players!, cards: s.cards!,
    combat: null, highlighted: new Set(), stack: [], handStart,
  }
  const out = LAYOUTS.main(i)
  const ids = s.players![meId].zones.hand
  const shown = ids.map((id) => out.placements.get(id)!).filter((p): p is Placement => p.kind === 'hand')
  return { out, ids, shown, row: out.regions.hand }
}

const VIEWS = [{ w: 1207, h: 624 }, { w: 1366, h: 768 }, { w: 1920, h: 1080 }]

describe('your hand', () => {
  for (const view of VIEWS) {
    for (const n of [1, 7, 10, 11, 25, 50]) {
      it(`${n} cards at ${view.w}×${view.h}: inside the hand row, each card's name start in view`, () => {
        const { shown, ids, row } = layout(withHand('four', n), view)
        expect(shown.length).toBeGreaterThan(0)
        expect(shown.length).toBeLessThanOrEqual(ids.length)
        const ys = shown.map((p) => p.y)
        expect(Math.max(...ys) - Math.min(...ys), 'the fan stays shallow').toBeLessThanOrEqual(20)
        for (const p of shown) expect(p.x >= row.x - 0.5 && p.x + p.w <= row.x + row.w + 0.5, `x ${p.x}`).toBe(true)
        const xs = shown.map((p) => p.x).sort((a, b) => a - b)
        for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(shown[0].w * 0.33)
      })
    }
  }

  it('fans up to 10 cards and lies flat past that', () => {
    expect(layout(withHand('four', 10), VIEWS[1]).shown.some((p) => p.rot !== 0)).toBe(true)
    expect(layout(withHand('four', 11), VIEWS[1]).shown.every((p) => p.rot === 0)).toBe(true)
  })

  it('shows the whole hand while it fits, without scrolling', () => {
    const { out, shown, ids } = layout(withHand('four', 11), VIEWS[2])
    expect(shown.length).toBe(ids.length)
    expect(out.hand).toBeUndefined()
  })

  it('scrolls 50 cards: a window that moves with handStart and stops at the ends', () => {
    const s = withHand('four', 50)
    const first = layout(s, VIEWS[0])
    const order = first.out.hand!.ids
    expect([...order].sort()).toEqual([...first.ids].sort())
    expect(first.out.hand!.start).toBe(0)
    expect(first.out.hand!.shown).toBe(first.shown.length)
    expect(first.shown.length).toBeLessThan(50)
    const visible = (r: ReturnType<typeof layout>) => order.filter((id) => r.out.placements.get(id)!.kind === 'hand')
    expect(visible(first)).toEqual(order.slice(0, first.shown.length))
    const later = layout(s, VIEWS[0], 10)
    expect(visible(later)).toEqual(order.slice(10, 10 + first.shown.length))
    const past = layout(s, VIEWS[0], 999)
    expect(past.out.hand!.start).toBe(50 - first.shown.length)
    for (const id of order.slice(first.shown.length)) {
      const p = first.out.placements.get(id)!
      expect(p.kind).toBe('zone')
      expect(p.opacity).toBe(0)
    }
  })
})
