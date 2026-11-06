// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '../protocol'
import { PassMenu } from '../shell/PassMenu'
import { useForge } from '../store'
import { RevealFlyout } from './RevealFlyout'
import { Timeline } from './Timeline'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A spectator (a watch ticket) has no seat, and until the first state no game either. A selector that answers a
// fresh value for the same store (s.game?.localPlayerIds ?? []) made React loop until it gave up (error #185).
function Table() {
  return (
    <>
      <RevealFlyout area={() => ({ x: 0, y: 0, w: 800, h: 600 })} />
      <Timeline />
      <PassMenu />
    </>
  )
}

let root: Root
let host: HTMLDivElement
const errors: unknown[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host, { onUncaughtError: (e) => errors.push(e), onRecoverableError: (e) => errors.push(e) })
  errors.length = 0
  vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('the table as a spectator', () => {
  it('stays mounted with no game yet', () => {
    useForge.setState({ inMatch: true, game: null, players: {}, cards: {}, reveals: [], reveal: null })
    act(() => root.render(<Table />))
    for (const b of host.querySelectorAll('button')) if (b.textContent?.includes('Pass until')) act(() => b.click())
    expect(errors).toEqual([])
    expect(host.textContent).toContain('Timeline')
  })

  it('stays mounted in a live game it has no seat in, and through a reveal', () => {
    useForge.setState({ inMatch: true, game: null, reveals: [], reveal: null })
    act(() => root.render(<Table />))
    act(() => useForge.getState().apply({
      t: 'state', seq: 1, full: true, logReset: true, logAppend: [{ type: 'TURN', message: 'Turn 3 (AI 1)' }],
      game: { turn: 3, phase: 'MAIN1', activePlayerId: 2, priorityPlayerId: 2, localPlayerIds: [], gameOver: false, winner: null },
      players: [{ id: 2, name: 'AI 1', life: 20 }] as never,
      cards: [{ id: 7, name: 'Hill Giant', zone: 'hand', ownerId: 2, controllerId: 2, hidden: false, img: null, manaCost: '{3}{R}', colors: 'R', typeLine: 'Creature — Giant', types: ['Creature'], text: '', power: 3, toughness: 3, counters: {}, keywords: [], attachmentIds: [], heldExileIds: [] }] as never,
    } as ServerMessage))
    act(() => useForge.getState().apply({ t: 'reveal', title: '', cardIds: [7] }))
    expect(errors).toEqual([])
    expect(host.querySelector('[data-reveal]')).not.toBeNull()
  })
})
