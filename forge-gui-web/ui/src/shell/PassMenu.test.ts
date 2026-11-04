import { describe, expect, it } from 'vitest'
import type { PlayerDto } from '../protocol'
import { useForge } from '../store'
import { passChoices } from './PassMenu'

const player = (id: number, name: string, hasLost = false) => ({ id, name, hasLost }) as PlayerDto
const pod = { 1: player(1, 'You'), 2: player(2, 'Ann'), 3: player(3, 'Ben', true), 4: player(4, 'Cat') }

describe('passChoices', () => {
  it('lists the living opponents’ end steps in turn order after you', () => {
    const labels = passChoices(pod, [1], [2, 3, 4, 1], 0).map((c) => c.label)
    expect(labels).toEqual(['Until end of turn', 'Until Ann’s end step', 'Until Cat’s end step', 'Until my next turn'])
  })

  it('offers the stack only with something on it', () => {
    const c = passChoices(pod, [1], undefined, 2)
    expect(c[0]).toEqual({ label: 'Until the stack resolves', msg: { t: 'yield', kind: 'stack' } })
    expect(c.find((x) => x.label.includes('Cat'))?.msg).toEqual({ t: 'yield', kind: 'endStep', playerId: 4 })
  })
})

describe('autopass message', () => {
  it('keeps the yield, hold and why it stopped', () => {
    useForge.getState().apply({ t: 'autopass', yield: { kind: 'endStep', label: 'Passing until Ann’s end step', playerId: 2 }, hold: false })
    expect(useForge.getState().autopass).toEqual({ yield: { kind: 'endStep', label: 'Passing until Ann’s end step', playerId: 2 }, hold: false, stopped: null, stackId: null })
    useForge.getState().apply({ t: 'autopass', yield: null, hold: true, stopped: 'Ann cast Shock targeting you', stackId: 7 })
    expect(useForge.getState().autopass).toEqual({ yield: null, hold: true, stopped: 'Ann cast Shock targeting you', stackId: 7 })
  })
})
