import { describe, expect, it } from 'vitest'
import { card } from '../board/fixtures/factory'
import { boardIdentity, identity, toneBackground, toneStops } from './tones'

describe('colour-identity blend (Q-01)', () => {
  it('orders WUBRG and dedupes', () => {
    expect(identity('GWUG')).toEqual(['W', 'U', 'G'])
    expect(identity('rbx')).toEqual(['B', 'R'])
  })
  it('colourless gets the neutral tone', () => {
    expect(toneBackground('')).toBe('var(--lk-tone-c)')
    expect(toneBackground('C')).toBe('var(--lk-tone-c)')
  })
  it('one colour is flat, active half uses the bright token', () => {
    expect(toneBackground('U')).toBe('var(--lk-tone-u)')
    expect(toneBackground('U', true)).toBe('var(--lk-tone-u-hi)')
  })
  it('two colours split into flat bands with a soft seam', () => {
    expect(toneStops('GW')).toBe('var(--lk-tone-w) 0%, var(--lk-tone-w) 47%, var(--lk-tone-g) 53%, var(--lk-tone-g) 100%')
    expect(toneBackground('GW')).toMatch(/^linear-gradient\(90deg, /)
  })
  it('three to five colours get even bands', () => {
    expect(toneStops('UBR')).toBe(
      'var(--lk-tone-u) 0%, var(--lk-tone-u) 30.33%, var(--lk-tone-b) 36.33%, var(--lk-tone-b) 63.67%, var(--lk-tone-r) 69.67%, var(--lk-tone-r) 100%',
    )
    expect(toneStops('WUBRG').split(', ')).toHaveLength(10)
  })
  it('board fallback prefers basic land types', () => {
    const forest = card({ name: 'Forest', types: ['Land'], typeLine: 'Basic Land — Forest' })
    const shock = card({ name: 'Temple Garden', types: ['Land'], typeLine: 'Land — Forest Plains' })
    const bolt = card({ name: 'Goblin', colors: 'R', types: ['Creature'] })
    expect(boardIdentity([forest, shock, bolt])).toEqual(['W', 'G'])
    expect(boardIdentity([bolt])).toEqual(['R'])
  })
})
