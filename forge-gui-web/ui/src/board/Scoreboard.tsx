import type { ReactNode } from 'react'
import { GEMS, gemOf, stepWords, turnOf } from '../look/phase'
import type { PhaseName } from '../protocol'

export type ScoreSeat = { id: number; name: string; you?: boolean; out?: boolean }

/** Turn and phase, printed on the active player's mat. No plate. */
export function Scoreboard({ name, you, phase, turn, hint, net, order, activeId }: {
  name: string
  you: boolean
  phase: PhaseName | null
  turn?: number
  hint?: ReactNode
  net?: number
  order?: ScoreSeat[]
  activeId?: number
}) {
  const cur = gemOf(phase)
  const words = stepWords(phase)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 188, color: 'var(--lk-parchment)', borderTop: '1px solid rgb(242 234 214 / .4)', paddingTop: 6 }}>
      <div className="lk-title" title={turn ? `Turn ${turn}` : undefined} style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.15 }}>
        {name || you ? turnOf(name, you) : 'Opening Hands'}
        {turn != null && turn > 0 && <span style={{ fontWeight: 500, color: 'var(--lk-parchment-dim)' }}> · {turn}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {GEMS.map((_, i) => (
            <span key={i} style={{ width: i === cur ? 16 : 6, height: 6, borderRadius: 99, background: i === cur ? 'var(--lk-parchment)' : 'rgb(242 234 214 / .28)' }} />
          ))}
        </span>
        {net != null && net > 0 && <b className="lk-title" style={{ fontSize: 13, color: 'var(--lk-ember-light)' }}>−{net}</b>}
      </div>
      {words && <div style={{ fontSize: 12, lineHeight: 1.3, color: 'var(--lk-parchment-dim)' }}>{words}</div>}
      {hint && <div title={typeof hint === 'string' ? hint : undefined} style={{ fontSize: 13, lineHeight: 1.3, color: 'var(--lk-parchment)', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{hint}</div>}
      {order && order.length > 2 && (
        <div className="lk-title" style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>
          {order.map((s, i) => (
            <span key={s.id}>
              {i > 0 && <span style={{ color: 'var(--lk-parchment-mute)' }}> · </span>}
              <span style={{ color: s.id === activeId ? 'var(--lk-parchment)' : 'var(--lk-parchment-dim)', textDecoration: s.out ? 'line-through' : undefined }}>{s.you ? 'You' : s.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
