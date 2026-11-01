import type { ExpectStatic } from 'vitest'
import { replayInto, type Replay } from './replay'
import { useForge } from './store'

// For tests: replaying a seat's stream through the real store must end on the board the server recorded last.

const initial = useForge.getState()

function board(feed: () => void) {
  useForge.setState(initial, true)
  feed()
  const s = useForge.getState()
  return { game: s.game, players: s.players, cards: s.cards, stack: s.stack, combat: s.combat }
}

export function checkReplay(r: Replay, expect: ExpectStatic) {
  expect(r.end?.m, 'the replay ends with a snapshot').toBeTruthy()
  const replayed = board(() => replayInto(useForge.getState().apply, r))
  const recorded = board(() => useForge.getState().apply(r.end!.m!))
  expect(replayed).toEqual(recorded)
}
