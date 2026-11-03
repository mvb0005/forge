// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { setSendTap } from '../net'
import type { Ask, CardDto, ClientMessage } from '../protocol'
import { useForge } from '../store'
import { OrderAsk } from './AskChoose'
import { cards } from './fixtures'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Order = Extract<Ask, { kind: 'order' }>

const ask: Order = {
  t: 'ask', id: 7, kind: 'order', title: 'Select order for simultaneous abilities', message: 'Resolve first',
  min: 2, max: 2, stack: true, cardId: null,
  items: [
    { i: 0, label: 'Whenever another creature enters the battlefield, you gain 1 life. [Phase: Player 1]', ref: { kind: 'card', id: 31 } },
    { i: 1, label: 'Birds of Paradise - Birds of Paradise deals 1 damage to any target. (Targeting: Serra Angel)', ref: { kind: 'card', id: 30 } },
  ],
}

let root: Root | undefined
let host: HTMLDivElement | undefined
let sent: ClientMessage[] = []

function mount(a: Order) {
  sent = []
  setSendTap((m) => { sent.push(m) })
  useForge.setState({ cards: Object.fromEntries(cards.map((c): [number, CardDto] => [c.id, c])) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<OrderAsk ask={a} />))
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = undefined
  setSendTap(null)
  useForge.setState({ cards: {} })
})

const rows = () => [...host!.querySelectorAll('[data-testid="stack-row"]')]
const button = (label: RegExp) => [...host!.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '') || label.test(b.title))!

describe('stack order', () => {
  it('shows each ability with its source card, its text and its target', () => {
    mount(ask)
    const [first, second] = rows()
    expect(first.textContent).toContain('Soul Warden')
    expect(first.textContent).toContain('Whenever another creature enters the battlefield, you gain 1 life.')
    expect(first.textContent).not.toContain('[Phase')
    expect(second.textContent).not.toContain('Birds of Paradise - ')
    expect(second.textContent).toContain('Targeting Serra Angel')
    expect(second.textContent).not.toContain('(Targeting')
    expect(host!.textContent).toMatch(/Resolves first.*Resolves last/s)
  })

  it('answers with the reordered items, top first', () => {
    mount(ask)
    act(() => rows()[1].querySelector<HTMLButtonElement>('button[title="Move up"]')!.click())
    expect(rows()[0].textContent).toContain('Birds of Paradise')
    act(() => button(/Put on the stack/).click())
    expect(sent).toEqual([{ t: 'answer', id: 7, value: [1, 0] }])
  })

  it("keeps the clicked row's card beside the list after the pointer leaves", () => {
    mount(ask)
    const aside = () => host!.querySelector('[role="dialog"] .shrink-0')?.textContent ?? ''
    act(() => { rows()[1].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // jsdom has no PointerEvent; React reads pointerover/pointerout for enter and leave.
    act(() => { rows()[0].dispatchEvent(new MouseEvent('pointerover', { bubbles: true })) })
    expect(aside()).not.toContain('Birds of Paradise')
    act(() => { rows()[0].dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })) })
    expect(rows()[1].classList.contains('border-target')).toBe(true)
    expect(rows()[0].classList.contains('border-target')).toBe(false)
    expect(aside()).toContain('Birds of Paradise')
  })

  it('keeps the pick-and-order dialog for other orders', () => {
    mount({ ...ask, stack: false })
    expect(rows()).toHaveLength(0)
    expect(host!.textContent).toContain('Confirm order')
  })
})
