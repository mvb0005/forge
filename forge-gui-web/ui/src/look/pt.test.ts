import { describe, expect, it } from 'vitest'
import { counterKind } from './CounterGem'
import { ptTone } from './PTPlate'

describe('ptTone', () => {
  it('printed without a base or when equal', () => {
    expect(ptTone(5, 5)).toBe('printed')
    expect(ptTone(3, 3, 0, { power: 3, toughness: 3 })).toBe('printed')
  })
  it('raised above the base, lowered below it or when damaged', () => {
    expect(ptTone(4, 4, 0, { power: 3, toughness: 3 })).toBe('raised')
    expect(ptTone(1, 1, 0, { power: 2, toughness: 2 })).toBe('lowered')
    expect(ptTone(5, 1, 0, { power: 3, toughness: 3 })).toBe('lowered')
    expect(ptTone(3, 6, 2)).toBe('lowered')
  })
  it('reads wire and fixture counter names', () => {
    expect(counterKind('+1/+1')).toBe('plus')
    expect(counterKind('P1P1')).toBe('plus')
    expect(counterKind('-1/-1')).toBe('minus')
    expect(counterKind('loyal')).toBe('loyalty')
    expect(counterKind('charge')).toBe('other')
  })
})
