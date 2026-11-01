import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { parseReplay } from '../src/replay'
import { checkReplay } from '../src/replayCheck'

// A real game's replay rebuilds its final board: FORGE_REPLAY=<file.jsonl.gz> npx vitest run tools/replay.check.test.ts
it.skipIf(!process.env.FORGE_REPLAY)('rebuilds a recorded game', () => {
  const r = parseReplay(gunzipSync(readFileSync(process.env.FORGE_REPLAY!)).toString('utf8'))
  const states = r.lines.filter((l) => l.m.t === 'state').length
  console.log(`${r.header.matchId} seat ${r.header.seat}: ${r.lines.length} messages, ${states} states, ${Math.round((r.end?.ms ?? 0) / 1000)} s, result ${r.end?.result.status}, log ${r.end?.result.log?.length ?? 0} lines`)
  checkReplay(r, expect)
})
