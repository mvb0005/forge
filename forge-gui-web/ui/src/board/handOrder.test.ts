import { describe, expect, it } from 'vitest'
import type { CardDto } from '../protocol'
import { orderedHand } from './handOrder'
import { landAbility, landChips } from './lands'

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

describe('landChips', () => {
  it('drops the tap-for-mana line and keeps a real ability', () => {
    expect(landAbility('({T}: Add {G} or {W}.)\nAs Temple Garden enters, you may pay 2 life.')).toBe('As Temple Garden enters, you may pay 2 life.')
    expect(landAbility('({T}: Add {G}.)')).toBeNull()
  })

  it('stacks basics and keeps an ability land on its own chip', () => {
    const forest = card(1, 'Forest', '', '({T}: Add {G}.)', ['Land'])
    const tapped = { ...forest, id: 2, tapped: true }
    const garden = card(3, 'Temple Garden', '', '({T}: Add {G} or {W}.)\nPay 2 life.', ['Land'])
    const chips = landChips([forest, tapped, garden])
    expect(chips.map((c) => [c.name, c.ids.length, c.tapped, c.ability])).toEqual([
      ['Forest', 2, 1, null],
      ['Temple Garden', 1, 0, 'Pay 2 life.'],
    ])
  })
})
