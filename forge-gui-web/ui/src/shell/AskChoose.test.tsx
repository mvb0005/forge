// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { setSendTap } from '../net'
import type { Ask, CardDto, ClientMessage } from '../protocol'
import { useForge } from '../store'
import { ChooseAsk } from './AskChoose'
import { cards } from './fixtures'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const byId: Record<number, CardDto> = Object.fromEntries(cards.map((c) => [c.id, c]))

type Choose = Extract<Ask, { kind: 'choose' }>

function choose(p: Omit<Choose, 't' | 'kind'>): Choose {
  return { t: 'ask', kind: 'choose', ...p }
}

function item(i: number, id: number, card: CardDto = byId[id]) {
  return { i, label: card.name, ref: { kind: 'card' as const, id } }
}

let root: Root | undefined
let host: HTMLDivElement | undefined
let sent: ClientMessage[]

function mount(ask: Choose, extra: Record<number, CardDto> = {}) {
  if (root) act(() => root!.unmount())
  host?.remove()
  sent = []
  setSendTap((m) => { sent.push(m) })
  useForge.setState({ cards: { ...byId, ...extra } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<ChooseAsk ask={ask} />))
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = undefined
  host = undefined
  setSendTap(null)
  useForge.setState({ cards: {} })
})

function row(name: RegExp) {
  const b = [...host!.querySelectorAll('button')].find((el) => name.test(el.textContent ?? ''))
  if (!b) throw new Error(`no row ${name}`)
  return b
}

function typeFilter(value: string) {
  const input = host!.querySelector('input')
  if (!input) throw new Error('no filter')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(el: Element, k: string) {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
}

const lands = choose({
  id: 1, title: 'Search your library', message: 'You may put a basic land into your hand',
  min: 0, max: 1, selected: [], items: [item(0, 21), item(1, 23), item(2, 25)],
})

describe('library search', () => {
  it('filters face-up library cards and answers on click', () => {
    mount(lands)
    const input = host!.querySelector('input')!
    expect(input.getAttribute('aria-label')).toBe('Filter by name or type')
    expect(document.activeElement).toBe(input)
    expect(host!.textContent).toContain('3/3')
    expect(row(/Island/)).toBeTruthy()
    expect(row(/Forest/)).toBeTruthy()

    typeFilter('  ISLAND ')
    expect(host!.textContent).toContain('1/3')
    expect(host!.textContent).not.toContain('Forest')
    expect(host!.textContent).toContain('Island')

    typeFilter('basic')
    expect(row(/Island/)).toBeTruthy()
    expect(row(/Forest/)).toBeTruthy()
    expect(row(/Mountain/)).toBeTruthy()

    typeFilter('zzz')
    expect(host!.textContent).toContain('No matching cards')

    typeFilter('forest')
    act(() => row(/Forest/).click())
    expect(sent).toEqual([{ t: 'answer', id: 1, value: [1] }])
  })

  it('answers the highlighted row on Enter and choose-nothing on Escape', () => {
    mount(lands)
    typeFilter('mountain')
    key(host!.querySelector('input')!, 'Enter')
    expect(sent).toEqual([{ t: 'answer', id: 1, value: [2] }])

    sent = []
    mount(lands)
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(sent).toEqual([{ t: 'answer', id: 1, value: [] }])
  })

  it('moves the highlight with the arrow keys', () => {
    mount(lands)
    const tokens = (name: RegExp) => row(name).className.split(/\s+/)
    expect(tokens(/Island/)).toContain('border-target')
    key(host!.querySelector('input')!, 'ArrowDown')
    expect(tokens(/Forest/)).toContain('border-target')
    expect(tokens(/Island/)).not.toContain('border-target')
  })

  it('toggles a multi search in click order and enforces max', () => {
    mount(choose({
      id: 4, title: 'Search your library', message: 'Up to two',
      min: 1, max: 2, selected: [], items: [item(0, 20), item(1, 21), item(2, 22)],
    }))
    const confirm = () => [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Confirm') as HTMLButtonElement
    expect(confirm().disabled).toBe(true)
    act(() => row(/Counterspell/).click())
    act(() => row(/Lightning Bolt/).click())
    act(() => row(/Island/).click())
    expect(row(/Counterspell/).textContent).toContain('1')
    expect(row(/Lightning Bolt/).textContent).toContain('2')
    expect(row(/Island/).textContent).not.toMatch(/[123]/)
    act(() => confirm().click())
    expect(sent).toEqual([{ t: 'answer', id: 4, value: [2, 0] }])
  })

  it('offers All only when every card may be taken', () => {
    mount(choose({
      id: 5, title: 'Search your library', message: 'Any number',
      min: 0, max: 3, selected: [], items: [item(0, 21), item(1, 23), item(2, 25)],
    }))
    const button = (name: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement
    act(() => button('All').click())
    expect(button('Clear')).toBeTruthy()
    act(() => button('Confirm').click())
    expect(sent).toEqual([{ t: 'answer', id: 5, value: [0, 1, 2] }])
  })

  it('keeps the card grid for battlefield cards, mixed zones, and hidden library cards', () => {
    mount(choose({
      id: 6, title: 'Choose target creature', message: 'Bolt',
      min: 1, max: 1, selected: [], items: [item(0, 11), item(1, 12)],
    }))
    expect(host!.querySelector('input')).toBeNull()

    const hidden: CardDto = { ...byId[21], id: 99, name: '', hidden: true, zone: 'library' }
    mount(choose({
      id: 7, title: 'Search', message: '',
      min: 1, max: 1, selected: [], items: [item(0, 99, hidden)],
    }), { 99: hidden })
    expect(host!.querySelector('input')).toBeNull()

    mount(choose({
      id: 8, title: 'Choose', message: '',
      min: 1, max: 1, selected: [], items: [item(0, 21), item(1, 31)],
    }))
    expect(host!.querySelector('input')).toBeNull()
  })
})
