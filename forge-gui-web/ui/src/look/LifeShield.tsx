import { memo, useId } from 'react'
import './theme'
import { Icon, KEYWORD_GLYPH } from './glyphs'

const SHIELD = 'M4 4h70v52L39 86 4 56z'
const ENGRAVE = 'M9.5 9.5h59v44L39 79.4 9.5 53.5z'

export type ShieldRim = 'metal' | 'bright' | 'active' | 'ember' | 'dim'
const RIM: Record<ShieldRim, string> = {
  metal: 'var(--lk-metal)', bright: 'var(--lk-metal-bright)', active: 'var(--lk-mythic-top)', ember: 'var(--lk-ember)', dim: 'var(--lk-metal-dark)',
}

export type CommanderHit = { name: string; amount: number }

/**
 * Life engraved on a loyalty shield. `preview` is the engine's combat result (combat assist lifeAfter);
 * it only shows when it differs. Commander damage per source needs the server to send it (not in PlayerDto yet).
 */
export const LifeShield = memo(function LifeShield({ life, preview = null, poison = 0, commander = [], width = 92, rim = 'metal', lethal = false }: {
  life: number
  preview?: number | null
  poison?: number
  commander?: CommanderHit[]
  width?: number
  rim?: ShieldRim
  lethal?: boolean
}) {
  const id = 'lkshield' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const h = width * (90 / 78)
  const showPreview = preview != null && preview !== life
  const color = lethal || (showPreview && preview! < life) ? 'var(--lk-ember)' : RIM[rim]
  const digits = String(life).length
  const fs = width * (digits > 2 ? 0.36 : 0.46)
  return (
    <span style={{ position: 'relative', display: 'inline-block', width, height: h, flex: 'none' }} title={`${life} life`}>
      <svg aria-hidden width={width} height={h} viewBox="0 0 78 90" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--lk-plate-top)" />
            <stop offset="1" stopColor="var(--lk-ink)" />
          </linearGradient>
        </defs>
        <path d={SHIELD} fill="#000" opacity={0.55} transform="translate(0 4)" />
        <path d={SHIELD} fill={`url(#${id})`} stroke={color} strokeWidth={2.6} strokeLinejoin="round" />
        <path d={ENGRAVE} fill="none" stroke={color} strokeOpacity={0.32} strokeWidth={1} strokeLinejoin="round" />
        {lethal && <path d="M39 6 35 22l7 9-6 12 5 10" fill="none" stroke="var(--lk-ember)" strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />}
      </svg>
      <span
        className="lk-title"
        style={{ position: 'absolute', left: 0, right: 0, top: showPreview ? h * 0.13 : h * 0.2, textAlign: 'center', fontWeight: 900, fontSize: fs, lineHeight: 1, color: 'var(--lk-parchment)', textShadow: '0 2px 0 rgb(0 0 0 / .6)' }}
      >
        {life}
      </span>
      {showPreview && (
        <span
          className="lk-title"
          style={{ position: 'absolute', left: 0, right: 0, top: h * 0.57, textAlign: 'center', fontWeight: 700, fontSize: width * 0.17, lineHeight: 1, color: preview! < life ? 'var(--lk-ember-light)' : 'var(--lk-frost)' }}
        >
          → {preview}
        </span>
      )}
      {poison > 0 && (
        <span
          className="lk-title"
          title={`${poison} poison`}
          style={{
            position: 'absolute', left: -width * 0.1, bottom: h * 0.08, display: 'inline-flex', alignItems: 'center', gap: 2, padding: `0 ${width * 0.06}px 0 ${width * 0.03}px`,
            borderRadius: 999, background: 'var(--lk-ink-2)', color: 'var(--lk-mana-g)', fontWeight: 900, fontSize: width * 0.15, lineHeight: `${width * 0.22}px`,
            boxShadow: '0 0 0 1.5px var(--lk-poison)',
          }}
        >
          <Icon g={KEYWORD_GLYPH.infect} size={width * 0.15} color="var(--lk-poison)" />
          {poison}
        </span>
      )}
      {commander.length > 0 && (
        <span style={{ position: 'absolute', left: '100%', marginLeft: width * 0.06, bottom: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {commander.map((c) => (
            <span
              key={c.name}
              className="lk-text"
              title={`Commander damage from ${c.name} (21 is lethal)`}
              style={{
                display: 'inline-flex', alignItems: 'baseline', gap: 4, padding: '0 7px', borderRadius: 6, background: 'var(--lk-ink-2)', whiteSpace: 'nowrap',
                boxShadow: '0 0 0 1px var(--lk-ember)', color: 'var(--lk-ember-light)', fontSize: Math.max(11, width * 0.14), fontWeight: 700, lineHeight: 1.35,
              }}
            >
              {c.name}
              <b className="lk-title" style={{ fontWeight: 900, color: 'var(--lk-parchment)' }}>{c.amount}</b>
              <span style={{ color: 'var(--lk-parchment-mute)', fontSize: '0.8em' }}>/21</span>
            </span>
          ))}
        </span>
      )}
    </span>
  )
})

/** Loyalty or defense on a card: the same shield, small, no gradient (it renders per card). */
export const StatShield = memo(function StatShield({ value, size = 34, kind = 'loyalty' }: { value: number; size?: number; kind?: 'loyalty' | 'defense' }) {
  const h = size * (90 / 78)
  return (
    <span title={`${value} ${kind}`} style={{ position: 'relative', display: 'inline-block', width: size, height: h }}>
      <svg aria-hidden width={size} height={h} viewBox="0 0 78 90" style={{ position: 'absolute', inset: 0 }}>
        <path d={SHIELD} fill={kind === 'loyalty' ? 'var(--lk-ink-2)' : 'var(--lk-ember-deep)'} stroke="var(--lk-parchment)" strokeWidth={5} strokeLinejoin="round" />
      </svg>
      <span className="lk-title" style={{ position: 'absolute', left: 0, right: 0, top: h * 0.16, textAlign: 'center', fontWeight: 900, fontSize: size * 0.48, lineHeight: 1, color: 'var(--lk-parchment)' }}>{value}</span>
    </span>
  )
})
