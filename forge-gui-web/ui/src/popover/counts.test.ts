import { describe, expect, it } from 'vitest'
import { countLabel, countedLines } from './counts'

const heliod = 'You may cast spells as though they had flash.\nSpells you cast cost {1} less to cast for each card your opponents have drawn this turn.'

describe('countedLines', () => {
  it('puts a count on the line of its ability', () => {
    const drawn = { text: 'Spells you cast cost {1} less to cast for each card your opponents have drawn this turn.', name: 'X', value: 3 }
    const { lines, rest } = countedLines(heliod, [drawn])
    expect(lines.map((l) => l.counts.length)).toEqual([0, 1])
    expect(rest).toEqual([])
  })

  it('matches a modal ability by its first line, and keeps what matches no line', () => {
    const text = 'When Stone Drake enters, choose one —\n• Target player discards a card for each spell you\'ve cast this turn.'
    const modal = { text: 'When Stone Drake enters, choose one —\n• Enthrall — Target player discards a card for each spell you\'ve cast this turn.', name: 'X', value: 2 }
    const stray = { text: 'Something the text doesn\'t say.', name: 'Y', value: 1 }
    const { lines, rest } = countedLines(text, [modal, stray])
    expect(lines[0].counts).toEqual([modal])
    expect(rest).toEqual([stray])
  })

  it('skips blank lines and keyword lines', () => {
    const { lines, rest } = countedLines('\nFlying', [{ text: 'Creatures you control with Flying get +1/+1 for each Bird you control.', name: 'X', value: 1 }])
    expect(lines.every((l) => l.counts.length === 0)).toBe(true)
    expect(rest).toHaveLength(1)
  })
})

describe('countLabel', () => {
  it('names the counts only when there are several', () => {
    expect(countLabel([{ text: '', name: 'X', value: 3 }])).toBe('3')
    expect(countLabel([{ text: '', name: 'X', value: 3 }, { text: '', name: 'Y', value: 0 }])).toBe('X 3 · Y 0')
  })
})
