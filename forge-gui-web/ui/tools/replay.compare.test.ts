import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { parseReplay, replayHello, type Replay } from '../src/replay'
import type { ServerMessage } from '../src/protocol'
import { useForge } from '../src/store'

// The server's recording projected for a seat shows what that seat was sent live (docs/REPLAYS.md R6): at every
// prompt the seat got it knows the same cards and sees the same of each, and at the end the whole board is the
// same. (The recording reads the board for a prompt a moment after the seat's own read, so the step, priority or
// a card's tapped and sick may have moved on.)
// FORGE_REPLAY=<projected seat N> FORGE_REPLAY_LIVE=<what seat N received, smoke.mjs --save> npx vitest run tools/replay.compare.test.ts
const file = process.env.FORGE_REPLAY
const live = process.env.FORGE_REPLAY_LIVE
const read = (f: string) => {
  const b = readFileSync(f)
  return parseReplay((b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString('utf8'))
}

const initial = useForge.getState()
const board = () => {
  const s = useForge.getState()
  const { seq: _, ...game } = (s.game ?? {}) as Record<string, unknown>
  return { game, players: s.players, cards: s.cards, stack: s.stack, combat: s.combat }
}

/** What a seat may see of each card it knows: the fields hidden information changes. A card only one side knows
 * yet (another player's card drawn between the two reads) must be hidden there: knowing it exists shows nothing. */
function seen(cards: ReturnType<typeof board>['cards'], other: ReturnType<typeof board>['cards']) {
  const out: Record<number, unknown> = {}
  for (const c of Object.values(cards)) out[c.id] = other[c.id] || !c.hidden ? [c.hidden, c.name, c.img, c.backImg, c.text] : 'hidden, not known to the other'
  return out
}
const known = (a: ReturnType<typeof board>['cards'], b: ReturnType<typeof board>['cards']) =>
  Object.fromEntries(Object.entries(seen(a, b)).filter(([id, v]) => b[Number(id)] || v !== 'hidden, not known to the other'))

/** Which parts of two boards differ, field by field. */
function what(a: ReturnType<typeof board>, b: ReturnType<typeof board>): string {
  const out: string[] = []
  const diff = (path: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) diff(`${path}.${k}`, (x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k])
    } else out.push(`${path}: ${JSON.stringify(x)?.slice(0, 80)} vs ${JSON.stringify(y)?.slice(0, 80)}`)
  }
  diff('', a, b)
  return out.slice(0, 6).join('; ')
}

/** The board each time a prompt arrives, then at the end. */
function boards(r: Replay) {
  useForge.setState(initial, true)
  useForge.getState().apply(replayHello(r.header))
  const out: ReturnType<typeof board>[] = []
  for (const { m } of r.lines) {
    if (m.t === 'prompt') out.push(board())
    useForge.getState().apply(m as ServerMessage)
  }
  out.push(board())
  return out
}

it.skipIf(!file || !live)('a projected seat sees what that seat did live', () => {
  const a = boards(read(file!))
  const b = boards(read(live!))
  console.log(`${a.length - 1} prompts projected, ${b.length - 1} live`)
  expect(a.length).toEqual(b.length)
  let differ = 0
  a.forEach((x, i) => {
    expect(known(x.cards, b[i].cards), `what the seat could see at prompt ${i}`).toEqual(known(b[i].cards, x.cards))
    if (JSON.stringify(x) !== JSON.stringify(b[i]) && differ++ < 10) console.log(`at prompt ${i}: ${what(x, b[i])}`)
  })
  console.log(`${differ} of ${a.length} boards differ (a moment later: step, priority, sickness, log, combat)`)
  expect(a[a.length - 1]).toEqual(b[b.length - 1])
})
