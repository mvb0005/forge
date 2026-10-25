// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURES } from '../board/fixtures'
import type { CardDto, CombatDto, PlayerDto, ServerMessage } from '../protocol'
import { useForge } from '../store'
import { CardLayer, renderCounts, useTableLayout } from './CardLayer'
import { LAYOUTS } from './layouts'
import { peekTimer, usePopover } from '../popover/store'
import { WARM_GROW_MS } from '../popover/timing'
import { grownRect } from '../popover/place'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VIEW = { w: 1600, h: 900 }

function Harness() {
  const { layout } = useTableLayout(VIEW)
  return <CardLayer layout={layout} />
}

// jsdom has no Web Animations; record the first keyframe of each animation per element.
const firstFrames = new Map<Element, string>()
beforeEach(() => {
  firstFrames.clear()
  Element.prototype.animate = function (this: Element, frames: Keyframe[]) {
    firstFrames.set(this, String(frames[0].transform))
    return { cancel() {}, playState: 'running', effect: { getComputedTiming: () => ({ progress: 0 }) }, onfinish: null } as unknown as Animation
  } as Element['animate']
})

let root: Root
let host: HTMLDivElement
function mount(fixture: string) {
  const f = FIXTURES.find((x) => x.id === fixture)!
  useForge.setState({ inMatch: true, ...f.state() })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Harness />))
}
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

let seq = 1
const send = (m: Omit<Extract<ServerMessage, { t: 'state' }>, 't' | 'seq' | 'full'>) =>
  act(() => useForge.getState().apply({ t: 'state', seq: seq++, full: false, ...m }))
const el = (id: number) => host.querySelector(`[data-entity="card:${id}"]`) as HTMLElement | null
const cardNamed = (name: string, ctrl = 1) => Object.values(useForge.getState().cards).find((c) => c.name === name && c.controllerId === ctrl && c.zone === 'battlefield')!
const translate = (t: string) => t.match(/translate\([^)]*\)/)![0]
const me = () => useForge.getState().players[1]
const withZones = (p: PlayerDto, z: Partial<PlayerDto['zones']>): PlayerDto => ({ ...p, zones: { ...p.zones, ...z } })

describe('card layer subscriptions (M1.5)', () => {
  for (const fixture of ['quiet', 'pod', 'commander']) {
    it(`a one-card P/T change re-renders exactly one card element (${fixture})`, () => {
      mount(fixture)
      const c = Object.values(useForge.getState().cards).find(
        (c) => c.zone === 'battlefield' && c.controllerId === 1 && c.types.includes('Creature') && el(c.id)?.dataset.ids === String(c.id),
      )!
      renderCounts.clear()
      send({ cards: [{ ...c, power: c.power! + 3 }] })
      expect([...renderCounts]).toEqual([[c.id, 1]])
      expect(el(c.id)!.textContent).toContain(`${c.power! + 3}/`)
    })
  }

  it('a re-sent card with no changes re-renders nothing', () => {
    mount('quiet')
    const c = cardNamed("Ajani's Pridemate")
    renderCounts.clear()
    send({ cards: [{ ...c, counters: { ...c.counters } }] })
    expect(renderCounts.size).toBe(0)
  })

  it('a P/T change that splits a token group re-renders only elements that changed', () => {
    mount('pod')
    const spirits = Object.values(useForge.getState().cards).filter((c) => c.name === 'Spirit')
    const before = new Map([...host.querySelectorAll<HTMLElement>('[data-entity]')].map((n) => [n.dataset.entity, n.dataset.ids + n.style.transform]))
    renderCounts.clear()
    send({ cards: [{ ...spirits[2], power: 2 }] })
    expect(renderCounts.has(spirits[2].id)).toBe(true) // the new ×1 element
    for (const id of renderCounts.keys()) {
      const n = el(id)!
      expect(before.get(`card:${id}`), `card ${id}`).not.toBe(n.dataset.ids! + n.style.transform)
    }
  })
})

describe('card layer motion (M1.4)', () => {
  it('a card moving hand → battlefield → graveyard keeps its element', () => {
    mount('quiet')
    const id = me().zones.hand[0]
    const node = el(id)
    const before = node!.style.transform
    const card = useForge.getState().cards[id]
    send({ cards: [{ ...card, zone: 'battlefield' }], players: [withZones(me(), { hand: me().zones.hand.slice(1), battlefield: [...me().zones.battlefield, id] })] })
    expect(el(id)).toBe(node)
    expect(node!.style.transform).not.toBe(before)
    expect(translate(firstFrames.get(node!)!)).toBe(translate(before)) // FLIP: starts where it was
    send({ cards: [{ ...card, zone: 'graveyard' }], players: [withZones(me(), { battlefield: me().zones.battlefield.filter((x) => x !== id), graveyard: [...me().zones.graveyard, id] })] })
    expect(el(id)).toBe(node)
    expect(node!.style.opacity).toBe('0')
  })

  it('a card moving between rows and across the table keeps its element', () => {
    mount('quiet')
    const opp = useForge.getState().players[2]
    const bear = cardNamed('Ledger Shredder', 2)
    const node = el(bear.id)
    const y0 = node!.style.transform
    // Control changes: it moves from the opponent's half to yours.
    send({
      cards: [{ ...bear, controllerId: 1 }],
      players: [withZones(opp, { battlefield: opp.zones.battlefield.filter((x) => x !== bear.id) }), withZones(me(), { battlefield: [...me().zones.battlefield, bear.id] })],
    })
    expect(el(bear.id)).toBe(node)
    expect(node!.style.transform).not.toBe(y0)
    // A land becomes a creature: back row to front row.
    const land = me().zones.battlefield.map((id) => useForge.getState().cards[id]).find((c) => c.name === 'Temple Garden')!
    const ln = el(land.id)
    send({ cards: [{ ...land, types: ['Land', 'Creature'], power: 3, toughness: 3 }] })
    expect(el(land.id)).toBe(ln)
  })

  it('switching main ↔ combat mode moves the same elements', () => {
    mount('pod')
    const combat = useForge.getState().combat
    const nodes = () => new Map([...host.querySelectorAll('[data-entity]')].map((n) => [n.getAttribute('data-entity'), n]))
    const before = nodes()
    send({ combat: null })
    const main = nodes()
    send({ combat })
    const after = nodes()
    for (const [k, n] of before) expect(after.get(k), k!).toBe(n)
    for (const [k, n] of main) if (after.has(k)) expect(after.get(k), k!).toBe(n)
  })

  it('a token group keeps its element across modes; only its attacking part goes to the lane (D-10)', () => {
    mount('commander')
    const cards = useForge.getState().cards
    const soldiers = me().zones.battlefield.filter((id) => cards[id].name === 'Soldier' && !cards[id].tapped && !cards[id].counters.P1P1)
    const head = el(soldiers[0])!
    const home = head.style.transform
    expect(head.dataset.ids!.split(' ').length).toBe(soldiers.length)
    const attack = (ids: number[]): CombatDto => ({ bands: ids.map((a) => ({ attackerIds: [a], defender: { kind: 'player', id: 2 }, blockerIds: [], plannedBlockerIds: [] })) })
    // Four members attack: one ×4 element flies out of the group into the lane, the group stays home.
    const att = soldiers.slice(1, 5)
    send({ combat: attack(att) })
    expect(el(soldiers[0])).toBe(head)
    expect(head.dataset.ids!.split(' ').length).toBe(soldiers.length - 4)
    const lane = el(att[0])!
    expect(lane.dataset.ids).toBe(att.join(' '))
    expect(translate(firstFrames.get(lane)!)).toBe(translate(home))
    send({ combat: null })
    expect(el(soldiers[0])).toBe(head)
    expect(head.dataset.ids!.split(' ').length).toBe(soldiers.length)
    // The head itself attacks: its element goes to the lane, the rest of the group gets an element
    // that starts at the group's place.
    send({ combat: attack(soldiers.slice(0, 2)) })
    expect(el(soldiers[0])).toBe(head)
    expect(head.dataset.ids).toBe(`${soldiers[0]} ${soldiers[1]}`)
    const rest = el(soldiers[2])!
    expect(rest.dataset.ids!.split(' ').length).toBe(soldiers.length - 2)
    expect(translate(firstFrames.get(rest)!)).toBe(translate(home))
  })

  it('lays out again only when the structural signature changes (M1.5)', () => {
    mount('quiet')
    const spy = vi.spyOn(LAYOUTS, 'main')
    const c = cardNamed("Ajani's Pridemate")
    send({ cards: [{ ...c, power: c.power! + 1, damage: 1 }] })
    expect(spy).toHaveBeenCalledTimes(0)
    send({ cards: [{ ...useForge.getState().cards[c.id], tapped: !c.tapped }] })
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('a member leaving a group flies out of the group, and back in when it rejoins (D-11)', () => {
    mount('four')
    const goblins = Object.values(useForge.getState().cards).filter((c) => c.name === 'Goblin' && c.tapped) as CardDto[]
    const combat = useForge.getState().combat!
    const head = el(goblins[0].id)!
    const groupAt = head.style.transform
    expect(head.dataset.ids!.split(' ')).toContain(String(goblins[3].id))
    // You block one member of the attacking group with Selfless Spirit: it gets its own lane element.
    const spirit = cardNamed('Selfless Spirit')
    const blocked: CombatDto = {
      bands: combat.bands.map((b) => (b.attackerIds[0] === goblins[3].id ? { ...b, plannedBlockerIds: [spirit.id] } : b)),
    }
    send({ combat: blocked })
    const solo = el(goblins[3].id)!
    expect(solo).not.toBe(head)
    expect(translate(firstFrames.get(solo)!)).toBe(translate(groupAt))
    expect(head.dataset.ids!.split(' ')).not.toContain(String(goblins[3].id))
    // The block is removed: it flies back onto the group, then its element goes.
    send({ combat })
    expect(el(goblins[3].id)).toBe(solo)
    expect(solo.style.opacity).toBe('0')
    expect(head.dataset.ids!.split(' ')).toContain(String(goblins[3].id))
  })
})

describe('hover grow (D-09)', () => {
  it('draws a pointer-transparent copy at the grown rect and leaves the real element alone', () => {
    mount('quiet')
    const c = cardNamed("Ajani's Pridemate")
    const node = el(c.id)!
    const before = node.style.transform
    const anchor = { x: 400, y: 500, w: 100, h: 140 }
    act(() => usePopover.setState({ peek: { key: `card:${c.id}`, entity: { kind: 'card', id: c.id }, anchor }, grownCardId: c.id }))
    const grown = document.querySelector(`[data-grown="${c.id}"]`) as HTMLElement
    const r = grownRect(anchor, { w: window.innerWidth, h: window.innerHeight })
    expect(grown.className).toContain('pointer-events-none')
    expect([grown.style.left, grown.style.top, grown.style.width]).toEqual([`${r.x}px`, `${r.y}px`, `${r.w}px`])
    expect(node.style.transform).toBe(before)
    act(() => usePopover.setState({ peek: null, grownCardId: null }))
    expect(document.querySelector('[data-grown]')).toBeNull()
  })

  it('shrinks the grown card when the hovered card moves away', async () => {
    mount('quiet')
    const id = me().zones.hand[0]
    const key = `card:${id}`
    act(() => peekTimer.show(key, { key, entity: { kind: 'card', id }, anchor: { x: 400, y: 700, w: 100, h: 140 } }))
    await act(() => new Promise((r) => setTimeout(r, WARM_GROW_MS + 20)))
    expect(document.querySelector(`[data-grown="${id}"]`)).not.toBeNull()
    // Played: it flies to the battlefield, so the grown copy must not stay at the hand.
    const card = useForge.getState().cards[id]
    send({ cards: [{ ...card, zone: 'battlefield' }], players: [withZones(me(), { hand: me().zones.hand.slice(1), battlefield: [...me().zones.battlefield, id] })] })
    expect(document.querySelector('[data-grown]')).toBeNull()
    act(() => peekTimer.close())
  })
})
