import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { parseReplay, replayInto, type Replay } from '../src/replay'
import { useForge } from '../src/store'

// The server's recording projected for a seat ends on the board that seat was sent live (docs/REPLAYS.md R6):
// FORGE_REPLAY=<projected seat N> FORGE_REPLAY_LIVE=<what seat N received, smoke.mjs --save> npx vitest run tools/replay.compare.test.ts
const file = process.env.FORGE_REPLAY
const live = process.env.FORGE_REPLAY_LIVE
const read = (f: string) => {
  const b = readFileSync(f)
  return parseReplay((b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString('utf8'))
}

const initial = useForge.getState()
function board(r: Replay) {
  useForge.setState(initial, true)
  replayInto(useForge.getState().apply, r)
  const s = useForge.getState()
  return { game: s.game, players: s.players, cards: s.cards, stack: s.stack, combat: s.combat }
}

it.skipIf(!file || !live)('a projected seat ends where that seat did live', () => {
  const a = board(read(file!))
  const b = board(read(live!))
  const ids = (x: typeof a) => Object.keys(x.cards).map(Number).sort((p, q) => p - q)
  console.log(`projected ${ids(a).length} cards, live ${ids(b).length}`)
  expect(a.game).toEqual(b.game)
  expect(a.players).toEqual(b.players)
  expect(ids(a)).toEqual(ids(b))
  for (const id of ids(a)) expect(a.cards[id], `card ${id} ${b.cards[id]?.name}`).toEqual(b.cards[id])
  expect(a.stack).toEqual(b.stack)
  expect(a.combat).toEqual(b.combat)
})
