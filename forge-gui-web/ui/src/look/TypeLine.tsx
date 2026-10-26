import { memo, type ReactNode } from 'react'
import './theme'
import type { PhaseName } from '../protocol'
import { isCombat, stepWords, turnOf } from './phase'
import { PhaseGems } from './PhaseGems'

export type Seat = { id: number; name: string; you?: boolean; out?: boolean }

/**
 * The divider between the halves, read like a card's type line: "Vex's Turn — Combat · Declare Blockers".
 * Turns ember in combat. `order` (multiplayer, seating order from the active player on) draws the turn order.
 */
export const TypeLine = memo(function TypeLine({ activeName, you, phase, turn, hint, ledger, order, activeId, gemLabels = false }: {
  activeName: string
  you: boolean
  phase: PhaseName | null
  turn?: number
  hint?: ReactNode
  ledger?: ReactNode
  order?: Seat[]
  activeId?: number
  gemLabels?: boolean
}) {
  const combat = isCombat(phase)
  const words = stepWords(phase)
  return (
    <div
      className="lk-text"
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 22, height: 48, padding: '0 22px', borderRadius: 10, minWidth: 0,
        background: combat ? 'linear-gradient(var(--lk-plate-ember-top), var(--lk-plate-ember-bottom))' : 'linear-gradient(var(--lk-plate-top), var(--lk-ink-2))',
        boxShadow: `0 0 0 2px var(--lk-ink), 0 0 0 3.5px ${combat ? 'var(--lk-ember)' : 'var(--lk-metal)'}, 0 10px 24px rgb(0 0 0 / .6), inset 0 1px 0 rgb(255 255 255 / .06)`,
        color: 'var(--lk-parchment)',
      }}
    >
      <span className="lk-title" title={turn ? `Turn ${turn}` : undefined} style={{ fontWeight: 700, fontSize: 19, whiteSpace: 'nowrap', letterSpacing: '0.01em' }}>
        {activeName || you ? turnOf(activeName, you) : 'Opening Hands'}
        {words && <span style={{ color: 'var(--lk-parchment-dim)' }}> — </span>}
        {words}
      </span>
      <PhaseGems phase={phase} size={14} labels={gemLabels} />
      {ledger && <span className="lk-title" style={{ fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', color: combat ? 'var(--lk-ember-light)' : 'var(--lk-parchment-dim)' }}>{ledger}</span>}
      <span style={{ flex: 1 }} />
      {hint && <span style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{hint}</span>}
      {order && order.length > 2 && (
        <span className="lk-title" aria-label="Turn order" style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
          {order.map((s, i) => (
            <span key={s.id} style={{ display: 'contents' }}>
              {i > 0 && <span style={{ color: 'var(--lk-parchment-mute)' }}>›</span>}
              <span style={{ color: s.id === activeId ? 'var(--lk-mythic-top)' : s.out ? 'var(--lk-parchment-mute)' : s.you ? 'var(--lk-metal-bright)' : 'var(--lk-parchment)', textDecoration: s.out ? 'line-through' : undefined }}>
                {s.you ? 'You' : s.name}
              </span>
            </span>
          ))}
        </span>
      )}
    </div>
  )
})
