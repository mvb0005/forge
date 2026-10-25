import { describe, expect, it } from 'vitest'
import { GROWN_W, grownRect, placeBeside, placeFar, type Rect } from './place'

const view = { w: 1600, h: 900 }
const size = { w: 260, h: 200 }
const inside = (r: Rect, m = 12) => r.x >= m && r.y >= m && r.x + r.w <= view.w - m && r.y + r.h <= view.h - m
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('placeBeside', () => {
  it('goes on the side with more room, top-aligned', () => {
    const left = { x: 100, y: 300, w: 100, h: 140 }
    expect(placeBeside(left, size, view)).toEqual({ side: 'right', x: 208, y: 300, w: 260, h: 200 })
    const right = { x: 1400, y: 300, w: 100, h: 140 }
    expect(placeBeside(right, size, view)).toMatchObject({ side: 'left', x: 1400 - 8 - 260 })
  })

  it('clamps to the viewport near the bottom', () => {
    const r = placeBeside({ x: 100, y: 820, w: 100, h: 70 }, size, view)
    expect(r.y).toBe(900 - 12 - 200)
    expect(inside(r)).toBe(true)
  })

  it('falls back to below/above when neither side fits', () => {
    const wide = { x: 200, y: 100, w: 1200, h: 140 }
    const r = placeBeside(wide, size, view)
    expect(r.side).toBe('bottom')
    expect(overlaps(r, wide)).toBe(false)
    expect(inside(r)).toBe(true)
  })

  it('shrinks an oversize popover to the viewport', () => {
    const r = placeBeside({ x: 10, y: 10, w: 50, h: 50 }, { w: 3000, h: 2000 }, view)
    expect(r).toMatchObject({ w: 1576, h: 876 })
    expect(inside(r)).toBe(true)
  })

  it('never covers the grown card', () => {
    for (const card of [{ x: 20, y: 20, w: 80, h: 112 }, { x: 760, y: 400, w: 80, h: 112 }, { x: 1500, y: 780, w: 80, h: 112 }]) {
      const g = grownRect(card, view)
      const r = placeBeside(g, size, view)
      expect(overlaps(r, g)).toBe(false)
      expect(inside(r)).toBe(true)
    }
  })
})

describe('grownRect', () => {
  it('grows around the card centre and stays on screen', () => {
    const g = grownRect({ x: 760, y: 400, w: 80, h: 112 }, view)
    expect(g.w).toBe(GROWN_W)
    expect(g.x + g.w / 2).toBe(800)
    const corner = grownRect({ x: 0, y: 0, w: 80, h: 112 }, view)
    expect(corner).toMatchObject({ x: 8, y: 8 })
  })
})

describe('placeFar', () => {
  it('uses the opposite edge from the target', () => {
    expect(placeFar({ x: 100, y: 400, w: 100, h: 140 }, size, view)).toMatchObject({ side: 'right', x: 1600 - 12 - 260 })
    expect(placeFar({ x: 1400, y: 400, w: 100, h: 140 }, size, view)).toMatchObject({ side: 'left', x: 12 })
  })

  it('switches to top/bottom when the edge would cover a wide target', () => {
    const wide = { x: 0, y: 0, w: 1600, h: 300 }
    const r = placeFar(wide, size, view)
    expect(r.side).toBe('bottom')
    expect(overlaps(r, wide)).toBe(false)
  })
})
