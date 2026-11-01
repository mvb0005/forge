import { describe, expect, it } from 'vitest'
import { parseReplay } from './replay'
import { checkReplay } from './replayCheck'

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
})
