import { describe, expect, it } from 'vitest'
import { advanceReplay, beatMs, indexReplay, parseReplay, replayHello, seekReplay, stopAtSeq } from './replay'
import { checkReplay } from './replayCheck'
import { useForge } from './store'

const initial = useForge.getState()

// Replaying a seat's stream through the real store must end on the board the server recorded last.
// tools/replay.check.test.ts does the same for a real game's replay file.

const line = (o: object) => JSON.stringify(o)
const card = (id: number, name: string, zone = 'Battlefield') => ({ id, name, zone, ownerId: 0, controllerId: 0 })
const game = { turn: 1, phase: 'MAIN1', activePlayerId: 0, priorityPlayerId: 0, gameOver: false }

describe('replay', () => {
  it('rebuilds the final board from a stream of full and partial states', () => {
    const text = [
      line({ replay: 1, matchId: '0123456789abcdef', seat: 0, who: 'Matt', version: 2, caps: ['log.append'], format: 'commander', startedAt: 'x', seats: [] }),
      line({ ms: 1, m: { t: 'state', seq: 1, full: true, game, players: [{ id: 0, name: 'Matt', life: 40 }], cards: [card(1, 'Sol Ring'), card(2, 'Island')], logAppend: [{ type: 'Turn', message: 'Turn 1' }], logReset: true } }),
      line({ ms: 2, m: { t: 'prompt', playerId: 0, message: 'Play', cardId: null } }),
      line({ ms: 3, m: { t: 'state', seq: 2, full: false, players: [{ id: 0, name: 'Matt', life: 37 }], cards: [card(3, 'Golem Token')], removedCards: [2], logAppend: [{ type: 'Life', message: 'Matt 40 > 37' }] } }),
      line({ ms: 4, snapshot: true, result: { matchId: '0123456789abcdef', status: 'finished' }, m: { t: 'state', seq: 3, full: true, game, players: [{ id: 0, name: 'Matt', life: 37 }], cards: [card(1, 'Sol Ring'), card(3, 'Golem Token')], logAppend: [{ type: 'Turn', message: 'Turn 1' }, { type: 'Life', message: 'Matt 40 > 37' }], logReset: true } }),
    ].join('\n')
    const r = parseReplay(text)
    expect(r.lines).toHaveLength(3)
    checkReplay(r, expect)
  })

  // Turn t, phase p, cards given: one state message per stop.
  const state = (seq: number, turn: number, phase: string, ids: number[]) =>
    ({ t: 'state', seq, full: seq === 1, game: { ...game, turn, phase }, cards: ids.map((id) => card(id, `Card ${id}`)) })
  const header = line({ replay: 1, matchId: '0123456789abcdef', seat: 0, who: 'Matt', version: 2, caps: [], format: 'commander', startedAt: 'x', seats: [] })
  const stream = (msgs: object[]) => parseReplay([header, ...msgs.map((m, i) => line({ ms: i * 10, m }))].join('\n'))

  it('stops before each state after the first, and at the end', () => {
    const r = stream([
      state(1, 1, 'MAIN1', [1]),
      { t: 'prompt', playerId: 0, message: 'Play', cardId: null },
      state(2, 1, 'COMBAT_DECLARE_ATTACKERS', [2]),
      state(3, 2, 'UPKEEP', [3]),
    ])
    const idx = indexReplay(r, initial)
    expect(idx.stops.map((s) => [s.pos, s.seq, s.turn, s.phase])).toEqual([
      [2, 1, 1, 'MAIN1'],
      [3, 2, 1, 'COMBAT_DECLARE_ATTACKERS'],
      [4, 3, 2, 'UPKEEP'],
    ])
    expect(stopAtSeq(idx, 2)).toBe(1)
    expect(stopAtSeq(idx, 99)).toBe(2)
    seekReplay(r, idx, idx.stops[0].pos)
    expect(useForge.getState().prompt?.message).toBe('Play')
  })

  it('seeks to the same board as playing through, across keyframes', () => {
    const msgs = Array.from({ length: 450 }, (_, i) => state(i + 1, 1 + Math.floor(i / 50), 'MAIN1', i % 7 ? [i] : [i, i + 1000]))
    const r = stream(msgs)
    const idx = indexReplay(r, initial)
    expect(idx.keyframes).toHaveLength(5)
    const board = () => ({ game: useForge.getState().game, cards: useForge.getState().cards })
    for (const pos of [0, 1, 99, 100, 101, 250, 449, 450]) {
      useForge.setState(initial, true)
      useForge.getState().apply(replayHello(r.header))
      advanceReplay(r, 0, pos)
      const played = board()
      seekReplay(r, idx, pos)
      expect(board(), `position ${pos}`).toEqual(played)
    }
  })

  it('drops live-only messages and closes an ask at the next state', () => {
    const r = stream([
      state(1, 1, 'MAIN1', [1]),
      { t: 'timer', seconds: 10 },
      { t: 'ask', id: 1, kind: 'confirm', title: 'Mulligan?', message: '', cardId: null, options: ['Keep', 'Mulligan'], defaultIndex: 0 },
      state(2, 1, 'MAIN1', [1]),
    ])
    const idx = indexReplay(r, initial)
    seekReplay(r, idx, 3)
    expect(useForge.getState().ask?.id).toBe(1)
    expect(useForge.getState().respondBy).toBeNull()
    seekReplay(r, idx, 4)
    expect(useForge.getState().ask).toBeNull()
  })

  it('closes a reveal at the next step', () => {
    const r = stream([
      state(1, 1, 'MAIN1', [1]),
      { t: 'reveal', title: 'Revealed', cardIds: [1] },
      state(2, 1, 'MAIN1', [1]),
      state(3, 1, 'COMBAT_BEGIN', [1]),
    ])
    const idx = indexReplay(r, initial)
    seekReplay(r, idx, 3)
    expect(useForge.getState().reveal?.title).toBe('Revealed')
    seekReplay(r, idx, 4)
    expect(useForge.getState().reveal).toBeNull()
  })

  it('paces a beat by the recorded gap, kept between a glimpse and a second', () => {
    const r = parseReplay([header, ...[0, 5, 400, 100000].map((ms, i) => line({ ms, m: state(i + 1, 1, 'MAIN1', [1]) }))].join('\n'))
    const idx = indexReplay(r, initial)
    // The wait at a stop is the time until the next board arrived: 5 ms (raised to 120), 395 ms, 99.6 s (cut to 1 s).
    expect([0, 1, 2, 3].map((i) => beatMs(idx, i, 1))).toEqual([120, 400 - 5, 1000, 0])
    expect(beatMs(idx, 1, 4)).toBe((400 - 5) / 4)
  })
})
