// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { findEntity } from './Arrows'

function tree(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

describe('findEntity', () => {
  it('skips a command-zone ghost and a timeline mention, and uses the live card', () => {
    const root = tree(`
      <span data-entity="card:7">in the log</span>
      <div data-ghost="" data-entity="card:7">command zone copy</div>
      <div data-card-layer>
        <div data-entity="card:7" id="live">on the battlefield</div>
      </div>
    `)
    expect((findEntity(root, { kind: 'card', id: 7 }) as HTMLElement).id).toBe('live')
    root.remove()
  })

  it('does not use an invisible card-layer ghost when a real card exists', () => {
    const root = tree(`
      <div data-ghost="" data-entity="card:3">command zone</div>
      <div data-card-layer>
        <div data-entity="card:3" style="opacity:0">flying to the stack</div>
        <div data-entity="card:3" id="field">on the battlefield</div>
      </div>
    `)
    expect((findEntity(root, { kind: 'card', id: 3 }) as HTMLElement).id).toBe('field')
    root.remove()
  })

  it('finds a stack item, not a card id in the log', () => {
    const root = tree(`
      <span data-entity="card:9">log</span>
      <div data-entity="stack:501" id="stack">dock</div>
    `)
    expect((findEntity(root, 'stack:501') as HTMLElement).id).toBe('stack')
    root.remove()
  })
})
