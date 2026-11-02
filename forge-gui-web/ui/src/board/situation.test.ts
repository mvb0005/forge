import { describe, expect, it } from 'vitest'
import { promptText } from './situation'

describe('promptText', () => {
  it('rewrites a priority dump to a stack response', () => {
    expect(promptText('Priority: You / Turn: 8 / Stack: Empty', 'Counterspell'))
      .toBe('Respond to Counterspell, or pass to let it resolve')
  })

  it('rewrites an empty stack to play or pass', () => {
    expect(promptText('Priority: You / Turn: 4 / Phase: Main1 / Stack: Empty', undefined))
      .toBe('Play a land, cast a spell, or pass')
  })

  it('leaves a real instruction alone', () => {
    expect(promptText('Choose target creature', 'Go for the Throat')).toBe('Choose target creature')
  })
})
