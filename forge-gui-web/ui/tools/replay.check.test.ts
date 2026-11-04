import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { advanceReplay, indexReplay, parseReplay, replayHello, seekReplay } from '../src/replay'
import { checkReplay } from '../src/replayCheck'
import { useForge } from '../src/store'

// A real game's replay rebuilds its final board, and seeking lands where playing through does:
// FORGE_REPLAY=<file.jsonl.gz> npx vitest run tools/replay.check.test.ts
const file = process.env.FORGE_REPLAY
const read = () => parseReplay(gunzipSync(readFileSync(file!)).toString('utf8'))

it.skipIf(!file)('rebuilds a recorded game', () => {
  const r = read()
  const states = r.lines.filter((l) => l.m.t === 'state').length
  console.log(`${r.header.matchId} seat ${r.header.seat}: ${r.lines.length} messages, ${states} states, ${Math.round((r.end?.ms ?? 0) / 1000)} s, result ${r.end?.result.status}, log ${r.end?.result.log?.length ?? 0} lines`)
  checkReplay(r, expect)
})

it.skipIf(!file)('seeks a recorded game', () => {
  const r = read()
  const initial = useForge.getState()
  let t = performance.now()
  const idx = indexReplay(r, initial)
  console.log(`indexed in ${Math.round(performance.now() - t)} ms: ${idx.stops.length} stops, ${idx.keyframes.length} keyframes`)
  const board = () => {
    const s = useForge.getState()
    return { game: s.game, players: s.players, cards: s.cards, stack: s.stack, combat: s.combat, prompt: s.prompt, ask: s.ask }
  }
  useForge.setState(initial, true)
  useForge.getState().apply(replayHello(r.header))
  let at = 0
  const step = Math.max(1, Math.floor(idx.stops.length / 60))
  for (let i = 0; i < idx.stops.length; i += step) {
    const pos = idx.stops[i].pos
    advanceReplay(r, at, pos)
    at = pos
    const played = board()
    t = performance.now()
    seekReplay(r, idx, pos)
    const ms = performance.now() - t
    expect(board(), `stop ${i} (seq ${idx.stops[i].seq})`).toEqual(played)
    expect(ms).toBeLessThan(100)
  }
})
