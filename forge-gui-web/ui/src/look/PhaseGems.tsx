import { memo, useId } from 'react'
import './theme'
import type { PhaseName } from '../protocol'
import { GEMS, gemOf, isCombat } from './phase'

const RHOMB = 'M8 1l6 7-6 7-6-7z'

/** Five rarity gems: past common black, upcoming uncommon silver, current mythic (ember in combat). */
export const PhaseGems = memo(function PhaseGems({ phase, size = 15, labels = false }: { phase: PhaseName | null; size?: number; labels?: boolean }) {
  const id = 'lkgem' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const cur = gemOf(phase)
  const combat = isCombat(phase)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.55 }}>
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={combat ? 'var(--lk-ember-text)' : 'var(--lk-mythic-top)'} />
            <stop offset="1" stopColor={combat ? 'var(--lk-mythic-bottom)' : 'var(--lk-mythic-bottom)'} />
          </linearGradient>
        </defs>
      </svg>
      {GEMS.map((name, i) => {
        const now = i === cur
        const s = now ? size * 1.45 : size
        const fill = now ? `url(#${id})` : i < cur ? 'var(--lk-common)' : 'var(--lk-uncommon)'
        const edge = now ? 'var(--lk-mythic-edge)' : i < cur ? 'var(--lk-common-edge)' : 'var(--lk-uncommon-edge)'
        return (
          <span key={i} title={name} style={{ position: 'relative', display: 'grid', placeItems: 'center', width: s, height: s }}>
            {now && <span className="lk-glow" style={{ position: 'absolute', inset: -s * 0.35, borderRadius: '50%', background: `radial-gradient(closest-side, ${combat ? 'var(--lk-ember-soft)' : 'var(--lk-mythic-glow)'}, transparent)` }} />}
            <svg aria-hidden width={s} height={s} viewBox="0 0 16 16" style={{ position: 'relative', display: 'block' }}>
              <path d={RHOMB} fill={fill} stroke={edge} strokeWidth={now ? 1.1 : 1} strokeLinejoin="round" />
              <path d="M8 1.9 2.8 8H8z" fill="#fff" opacity={now ? 0.28 : i < cur ? 0.08 : 0.32} />
              <path d="M8 14.1 13.2 8H8z" fill="#000" opacity={0.18} />
            </svg>
          </span>
        )
      })}
      {labels && (
        <span className="lk-label" style={{ marginLeft: size * 0.3, fontSize: Math.max(10, size * 0.78), color: 'var(--lk-parchment-dim)', whiteSpace: 'nowrap' }}>
          {GEMS.map((g, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              <span style={i === cur ? { color: combat ? 'var(--lk-ember-text)' : 'var(--lk-mythic-top)' } : undefined}>{i === 0 ? 'Begin' : g}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  )
})
