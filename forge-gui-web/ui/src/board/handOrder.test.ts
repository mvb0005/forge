import { describe, expect, it } from 'vitest'
import type { CardDto } from '../protocol'
import { orderedHand } from './handOrder'
import { trayGroups } from './lands'

const card = (id: number, name: string, manaCost: string, text = '', types: string[] = ['Creature']): CardDto => ({
  id, zone: 'hand', ownerId: 1, controllerId: 1, hidden: false, name, img: null, backImg: null, manaCost, colors: '',
  typeLine: '', types, text, power: null, toughness: null, loyalty: null, defense: null, damage: 0, counters: {},
  keywords: [], tapped: false, sick: false, phasedOut: false, faceDown: false, token: false, attachedToId: null,
  attachedToPlayerId: null, attachmentIds: [], exiledWithId: null, heldExileIds: [], commander: false, sprocket: null,
})

describe('orderedHand', () => {
  const cards = {
    1: card(1, 'Bear', '{1}{G}'),
    2: card(2, 'Bolt', '{R}'),
    3: card(3, 'Angel', '{3}{W}{W}'),
    4: card(4, 'Forest', '', '({T}: Add {G}.)', ['Land']),
  }

  it('sorts by mana value, then name', () => {
    expect(orderedHand([3, 1, 2], cards, null)).toEqual([2, 1, 3])
  })

  it('keeps an arrangement and inserts a new card at its mana value', () => {
    expect(orderedHand([2, 3, 1, 4], cards, [3, 2])).toEqual([4, 1, 3, 2])
  })
})

describe('land tray', () => {
  it('names a land with an activated ability, and stacks an enters-tapped or shock dual by its colours', () => {
    const delta = card(1, 'Polluted Delta', '', '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.', ['Land'])
    const scry = card(2, 'Temple of Malady', '', 'Temple of Malady enters tapped.\nWhen Temple of Malady enters, scry 1.\n{T}: Add {B} or {G}.', ['Land'])
    const tower = card(3, 'Reliquary Tower', '', 'You have no maximum hand size.\n{T}: Add {C}.', ['Land'])
    expect(trayGroups([delta, scry, tower]).map((g) => [g.name, g.sym])).toEqual([
      [null, 'B/G'],
      [null, 'C'],
      ['Polluted Delta', 'C'],
    ])
  })

  it('stacks basics by the mana they make, tapped apart, and keeps a rock by name', () => {
    const forest = { ...card(1, 'Forest', '', '({T}: Add {G}.)', ['Land']), typeLine: 'Basic Land — Forest' }
    const tapped = { ...forest, id: 2, tapped: true }
    const garden = card(3, 'Temple Garden', '', '({T}: Add {G} or {W}.)\nPay 2 life.', ['Land'])
    const stone = card(4, 'Mind Stone', '{2}', '{T}: Add {C}.', ['Artifact'])
    const bear = card(5, 'Grizzly Bears', '{1}{G}')
    expect(trayGroups([forest, tapped, garden, stone, bear]).map((g) => [g.name, g.sym, g.open, g.tapped])).toEqual([
      [null, 'W/G', [3], []],
      [null, 'G', [1], [2]],
      ['Mind Stone', 'C', [4], []],
    ])
  })
})
