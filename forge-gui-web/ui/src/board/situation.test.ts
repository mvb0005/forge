import { describe, expect, it } from 'vitest'
import { promptText } from './situation'

const ALL = { land: true, spell: true, ability: true }

describe('promptText', () => {
  it('rewrites a priority dump to a stack response', () => {
    expect(promptText('Priority: You / Turn: 8 / Stack: Empty', 'Counterspell', ALL))
      .toBe('Respond to Counterspell, or pass to let it resolve')
  })

  it('rewrites an empty stack to what you could play, or pass', () => {
    const empty = 'Priority: You / Turn: 4 / Phase: Main1 / Stack: Empty'
    expect(promptText(empty, undefined, { land: true, spell: true, ability: false })).toBe('Play a land, cast a spell, or pass')
    expect(promptText(empty, undefined, { land: false, spell: true, ability: false })).toBe('Cast a spell or pass')
    expect(promptText(empty, undefined, { land: false, spell: true, ability: true })).toBe('Cast a spell, use an ability, or pass')
    expect(promptText(empty, undefined, { land: true, spell: false, ability: false })).toBe('Play a land or pass')
    expect(promptText(empty, undefined, { land: false, spell: false, ability: false })).toBe('Nothing to play: pass')
  })

  it('leaves a real instruction alone', () => {
    expect(promptText('Choose target creature', 'Go for the Throat', ALL)).toBe('Choose target creature')
  })
})
