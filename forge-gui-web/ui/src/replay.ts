import type { PhaseName, ServerMessage } from './protocol'
import { useForge, type ForgeState } from './store'

// A seat's replay (PROTOCOL.md "Replays"): every message the game server sent that seat, recorded as gzipped
// JSON lines and kept by the tracker. Replaying feeds the messages to the store as if they arrived live.

export type ReplayHeader = {
  replay: number
  matchId: string
  seat: number
  who: string
  version: number
  caps: string[]
  format: string
  startedAt: string
  seats: { index: number; kind: 'human' | 'ai'; name: string; deck: string }[]
  /** One view the tracker projected from a game's one replay (docs/REPLAYS.md D-R7); every other view may be asked for. */
  perspectives?: boolean
}

export type ReplayResult = { matchId: string; status: string; winner?: string; turn?: number; summary?: string; log?: string[] }

export type Replay = {
  header: ReplayHeader
  lines: { ms: number; m: ServerMessage }[]
  /** The final board as a full state (not applied when replaying: a replay is checked against it), and the result. */
  end: { ms: number; result: ReplayResult; m?: ServerMessage } | null
}

export function parseReplay(text: string): Replay {
  const rows = text.split('\n').filter((l) => l.trim())
  if (!rows.length) throw new Error('empty replay')
  const header = JSON.parse(rows[0]) as ReplayHeader
  if (header.replay !== 1) throw new Error(`replay format ${header.replay} is not 1`)
  const lines: Replay['lines'] = []
  let end: Replay['end'] = null
  for (const row of rows.slice(1)) {
    const l = JSON.parse(row)
    if (l.snapshot) end = { ms: l.ms, result: l.result, m: l.m }
    else lines.push({ ms: l.ms, m: l.m })
  }
  return { header, lines, end }
}

/** A replay file as the tracker serves it (gzipped), or already unzipped. */
export async function readReplay(data: ArrayBuffer): Promise<Replay> {
  const b = new Uint8Array(data, 0, Math.min(2, data.byteLength))
  const gzipped = b[0] === 0x1f && b[1] === 0x8b
  const text = gzipped
    ? await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(data)
  return parseReplay(text)
}

/** The replay file a page shows: ?replay=<url>, or a game's replay page /play/table/<match>/replay/ (router.conf),
 * whose file is the tracker's, for seat ?seat=N or the tracker's pick. */
export function replaySource(path: string, q: URLSearchParams): string | null {
  const src = q.get('replay')
  if (src) return src
  const id = /\/play\/table\/([0-9a-f]{16})\/replay\//.exec(path)?.[1]
  if (!id) return null
  const seat = q.get('seat')
  return `/play/games/${id}/replay${seat && /^\d+$/.test(seat) ? `/${seat}` : ''}`
}

/** The hello the seat's browser got when it connected; replays start with it. */
export function replayHello(h: ReplayHeader): ServerMessage {
  return { t: 'hello', version: h.version, caps: h.caps, inMatch: true, seat: h.seat, who: h.who } as ServerMessage
}

/** Feeds the first `upTo` messages (all by default) into apply. */
export function replayInto(apply: (m: ServerMessage) => void, r: Replay, upTo = r.lines.length) {
  apply(replayHello(r.header))
  for (const l of r.lines.slice(0, upTo)) apply(l.m)
}

// Watching a replay (docs/REPLAYS.md). A position is how many of the replay's messages have been applied. Playback
// stops just before each state message (and at the end), so a stop shows a board and what the player was asked
// on it; "at seq N" is the stop before state N + 1.

const KEYFRAME_EVERY = 100
const MIN_BEAT_MS = 120
const MAX_BEAT_MS = 1000

/** Applies one replayed message. Live-only messages are dropped. What the player closed isn't recorded, so an open
 * ask closes at the next state (the game thread waits on an ask until it's answered), and a reveal at the next step. */
function feed(m: ServerMessage) {
  if (m.t === 'timer' || m.t === 'ahead') return
  const s = useForge.getState()
  if (m.t === 'state' && s.ask) s.clearAsk()
  if (m.t === 'state' && s.reveal && m.game && (m.game.phase !== s.game?.phase || m.game.turn !== s.game?.turn)) s.clearReveal()
  s.apply(m)
}

/** quiet: nothing happened in the step this stop is in (no stack, no log beyond turn, phase and mana lines, nothing
 * asked), so stepping and playing may skip it. */
export type Stop = { pos: number; turn: number; phase: PhaseName | null; seq: number; ms: number; quiet: boolean }

const NOISE = new Set(['PHASE', 'TURN', 'MANA'])

export type ReplayIndex = {
  stops: Stop[]
  /** keyframes[k] is the store after the first k * KEYFRAME_EVERY messages. */
  keyframes: ForgeState[]
}

/** Applies the whole replay once from a clean store, keeping keyframes and the stops. */
export function indexReplay(r: Replay, initial: ForgeState): ReplayIndex {
  useForge.setState(initial, true)
  useForge.getState().apply(replayHello(r.header))
  const keyframes: ForgeState[] = []
  const stops: Stop[] = []
  let seq = 0
  let seqMs = 0 // when the state a stop shows arrived
  let busy = false // something happened since the last stop
  const stop = (pos: number) => {
    const s = useForge.getState()
    stops.push({ pos, turn: s.game?.turn ?? 0, phase: s.game?.phase ?? null, seq, ms: seqMs, quiet: !busy && !s.stack.length })
    busy = false
  }
  r.lines.forEach((l, i) => {
    if (i % KEYFRAME_EVERY === 0) keyframes.push(useForge.getState())
    if (l.m.t === 'state' && seq > 0) stop(i)
    if (l.m.t === 'ask' || (l.m.t === 'state' && l.m.logAppend?.some((e) => !NOISE.has(e.type)))) busy = true
    feed(l.m)
    if (l.m.t === 'state') {
      seq = l.m.seq
      seqMs = l.ms
    }
  })
  stop(r.lines.length)
  // A step is quiet only if every stop in it is.
  for (let a = 0; a < stops.length; ) {
    let b = a
    while (b + 1 < stops.length && stops[b + 1].turn === stops[a].turn && stops[b + 1].phase === stops[a].phase) b++
    const quiet = stops.slice(a, b + 1).every((x) => x.quiet)
    for (let i = a; i <= b; i++) stops[i].quiet = quiet
    a = b + 1
  }
  stops[0].quiet = stops[stops.length - 1].quiet = false
  return { stops, keyframes }
}

/** Puts the store at a position: the nearest keyframe at or before it, then the messages after that. */
export function seekReplay(r: Replay, idx: ReplayIndex, pos: number) {
  const k = Math.min(Math.floor(pos / KEYFRAME_EVERY), idx.keyframes.length - 1)
  useForge.setState(idx.keyframes[k], true)
  advanceReplay(r, k * KEYFRAME_EVERY, pos)
  useForge.setState({ notices: [] })
}

/** Moves the store forward from one position to a later one. */
export function advanceReplay(r: Replay, from: number, to: number) {
  for (let i = from; i < to; i++) feed(r.lines[i].m)
}

/** The stop showing seq N: the last stop at or before it. */
export function stopAtSeq(idx: ReplayIndex, seq: number): number {
  let best = 0
  idx.stops.forEach((s, i) => {
    if (s.seq <= seq) best = i
  })
  return best
}

/** How long to show a stop before playing the next one: the recorded gap, kept between a glimpse and a second. */
export function beatMs(idx: ReplayIndex, stop: number, speed: number): number {
  const a = idx.stops[stop], b = idx.stops[stop + 1]
  if (!b) return 0
  return Math.min(MAX_BEAT_MS, Math.max(MIN_BEAT_MS, b.ms - a.ms)) / speed
}
