import { describe, expect, it } from 'vitest'
import { parseCost, symInfo } from './mana'

describe('parseCost', () => {
  it('reads the braced form the server sends', () => {
    expect(parseCost('{2}{W}{U}')).toEqual(['2', 'W', 'U'])
    expect(parseCost('{X}{X}{R}')).toEqual(['X', 'X', 'R'])
    expect(parseCost('{10}{G}')).toEqual(['10', 'G'])
    expect(parseCost('{0}')).toEqual(['0'])
  })
  it('keeps hybrid, twobrid, phyrexian, colourless and snow shards whole', () => {
    expect(parseCost('{W/U}{2/W}{G/P}{B/G/P}{C}{S}{C/W}')).toEqual(['W/U', '2/W', 'G/P', 'B/G/P', 'C', 'S', 'C/W'])
  })
  it('accepts Forge script shorthand', () => {
    expect(parseCost('2 W U')).toEqual(['2', 'W', 'U'])
    expect(parseCost('2 WU')).toEqual(['2', 'W', 'U'])
    expect(parseCost('X R R')).toEqual(['X', 'R', 'R'])
    expect(parseCost('1 W/U G/P')).toEqual(['1', 'W/U', 'G/P'])
    expect(parseCost('12 g')).toEqual(['12', 'G'])
  })
  it('has nothing for no cost', () => {
    expect(parseCost('')).toEqual([])
    expect(parseCost(null)).toEqual([])
    expect(parseCost('no cost')).toEqual([])
  })
})

describe('symInfo', () => {
  it('describes each kind', () => {
    expect(symInfo('3')).toEqual({ colors: [], generic: '3', phyrexian: false, special: null })
    expect(symInfo('W/U')).toMatchObject({ colors: ['W', 'U'], generic: null })
    expect(symInfo('2/W')).toMatchObject({ colors: ['W'], generic: '2' })
    expect(symInfo('G/P')).toMatchObject({ colors: ['G'], phyrexian: true })
    expect(symInfo('T')).toMatchObject({ special: 'T', colors: [] })
    expect(symInfo('C')).toMatchObject({ colors: ['C'], special: null })
    expect(symInfo('X')).toMatchObject({ generic: 'X' })
  })
})
