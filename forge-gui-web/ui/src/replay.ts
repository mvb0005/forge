import type { ServerMessage } from './protocol'

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

/** A replay file as the tracker serves it (gzipped). */
export async function readReplay(data: ArrayBuffer): Promise<Replay> {
  const text = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  return parseReplay(text)
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
