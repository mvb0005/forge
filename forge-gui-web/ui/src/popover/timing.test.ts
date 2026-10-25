import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRACE_MS, GROW_MS, INTENT_MS, WARM_GROW_MS, createPeekTimer, type PeekOpen } from './timing'

let log: (string | null)[]
const fmt = (o: PeekOpen<string> | null) => (o ? `${o.key}${o.grown ? '+' : ''}` : null)
const make = () => createPeekTimer<string>((o) => log.push(fmt(o)))

beforeEach(() => {
  vi.useFakeTimers()
  log = []
})
afterEach(() => vi.useRealTimers())

describe('peek timing', () => {
  it('peeks after the intent delay, then grows', () => {
    const t = make()
    t.enter('a', 'A')
    vi.advanceTimersByTime(INTENT_MS - 1)
    expect(log).toEqual([])
    vi.advanceTimersByTime(1)
    expect(log).toEqual(['a'])
    vi.advanceTimersByTime(GROW_MS - INTENT_MS)
    expect(log).toEqual(['a', 'a+'])
  })

  it('never opens when the pointer leaves before the intent delay', () => {
    const t = make()
    t.enter('a', 'A')
    vi.advanceTimersByTime(INTENT_MS - 10)
    t.leave('a')
    vi.advanceTimersByTime(1000)
    expect(log).toEqual([])
  })

  it('shrinks at once on leave and closes after the grace', () => {
    const t = make()
    t.enter('a', 'A')
    vi.advanceTimersByTime(GROW_MS)
    log = []
    t.leave('a')
    expect(log).toEqual(['a'])
    vi.advanceTimersByTime(GRACE_MS - 1)
    expect(log).toEqual(['a'])
    vi.advanceTimersByTime(1)
    expect(log).toEqual(['a', null])
  })

  it('leaving between peek and grow cancels the grow', () => {
    const t = make()
    t.enter('a', 'A')
    vi.advanceTimersByTime(INTENT_MS)
    t.leave('a')
    vi.advanceTimersByTime(1000)
    expect(log).toEqual(['a', null])
  })

  it('stays warm: the next thing peeks at once and grows after the shorter dwell', () => {
    const t = make()
    t.enter('a', 'A')
    vi.advanceTimersByTime(GROW_MS)
    t.leave('a')
    vi.advanceTimersByTime(GRACE_MS / 2)
    log = []
    t.enter('b', 'B')
    expect(log).toEqual(['b'])
    vi.advanceTimersByTime(WARM_GROW_MS)
    expect(log).toEqual(['b', 'b+'])
    vi.advanceTimersByTime(GRACE_MS)
    expect(log).toEqual(['b', 'b+'])
  })

  it('goes cold again after the grace', () => {
    const t = make()
    t.enter('a', 'A')
    vi.advanceTimersByTime(INTENT_MS)
    t.leave('a')
    vi.advanceTimersByTime(GRACE_MS)
    log = []
    t.enter('b', 'B')
    expect(log).toEqual([])
    vi.advanceTimersByTime(INTENT_MS)
    expect(log).toEqual(['b'])
  })

  it('ignores a late leave from the previous element', () => {
    const t = make()
    t.enter('a', 'A')
    vi.advanceTimersByTime(INTENT_MS)
    t.enter('b', 'B')
    t.leave('a')
    vi.advanceTimersByTime(1000)
    expect(log).toEqual(['a', 'b', 'b+'])
  })

  it('re-entering the open thing is a no-op; re-entering during the grace keeps it open', () => {
    const t = make()
    t.enter('a', 'A')
    vi.advanceTimersByTime(INTENT_MS)
    t.enter('a', 'A')
    expect(log).toEqual(['a'])
    t.leave('a')
    vi.advanceTimersByTime(GRACE_MS - 1)
    t.enter('a', 'A')
    vi.advanceTimersByTime(GRACE_MS + WARM_GROW_MS)
    expect(log).toEqual(['a', 'a+'])
  })

  it('focus peeks at once; Esc closes and cancels anything pending', () => {
    const t = make()
    t.show('a', 'A')
    expect(log).toEqual(['a'])
    t.close()
    expect(log).toEqual(['a', null])
    t.enter('b', 'B')
    t.close()
    vi.advanceTimersByTime(1000)
    expect(log).toEqual(['a', null])
    expect(t.current()).toBeNull()
  })
})
