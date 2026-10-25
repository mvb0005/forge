import { memo } from 'react'
import './theme'
import { MANA_GLYPH } from './glyphs'
import { parseCost, symInfo, type Sym } from './mana'

const FILL: Record<string, string> = {
  W: 'var(--lk-mana-w)', U: 'var(--lk-mana-u)', B: 'var(--lk-mana-b)', R: 'var(--lk-mana-r)', G: 'var(--lk-mana-g)', C: 'var(--lk-mana-c)',
}
const UL = 'M26.61 5.39A15 15 0 0 0 5.39 26.61z' // upper-left half of the pip
const LR = 'M26.61 5.39A15 15 0 0 1 5.39 26.61z'

function Glyph({ k, x = 16, y = 16, scale = 0.72 }: { k: string; x?: number; y?: number; scale?: number }) {
  const g = MANA_GLYPH[k]
  if (!g) return null
  return (
    <path
      d={g.d}
      transform={`translate(${x - 12 * scale} ${y - 12 * scale}) scale(${scale})`}
      fill={g.s ? 'none' : 'var(--lk-mana-glyph)'}
      fillRule="evenodd"
      stroke={g.s ? 'var(--lk-mana-glyph)' : 'none'}
      strokeWidth={2.2}
      strokeLinecap="round"
    />
  )
}

function Num({ t, x = 16, y = 16, fs }: { t: string; x?: number; y?: number; fs?: number }) {
  const size = fs ?? (t.length > 1 ? 17 : 21)
  return (
    <text x={x} y={y} dy="0.36em" textAnchor="middle" fontFamily="var(--lk-font-title)" fontWeight={900} fontSize={size} fill="var(--lk-mana-glyph)">
      {t}
    </text>
  )
}

/** One symbol: W U B R G C, numbers, X, hybrids, twobrid, phyrexian, snow, tap/untap. */
export const ManaSymbol = memo(function ManaSymbol({ sym, size = 18, shadow = true }: { sym: Sym; size?: number; shadow?: boolean }) {
  const i = symInfo(sym)
  let body
  if (i.special === 'T' || i.special === 'Q' || i.special === 'E') {
    body = <><circle cx={16} cy={16} r={15} fill="var(--lk-mana-c)" /><Glyph k={i.special} scale={0.78} /></>
  } else if (i.special === 'S') {
    body = <><circle cx={16} cy={16} r={15} fill="var(--lk-mana-c)" /><Glyph k="S" scale={0.8} /></>
  } else if (i.colors.length === 2 || (i.colors.length === 1 && i.generic)) {
    const [a, b] = i.colors.length === 2 ? i.colors : [null, i.colors[0]]
    body = (
      <>
        <path d={UL} fill={a ? FILL[a] : 'var(--lk-mana-c)'} />
        <path d={LR} fill={FILL[b!]} />
        {a ? <Glyph k={a} x={11} y={11} scale={0.42} /> : <Num t={i.generic!} x={11} y={11} fs={13} />}
        <Glyph k={i.phyrexian ? 'P' : b!} x={21} y={21} scale={0.42} />
      </>
    )
  } else if (i.colors.length === 1) {
    const c = i.colors[0]
    body = <><circle cx={16} cy={16} r={15} fill={FILL[c]} /><Glyph k={i.phyrexian ? 'P' : c} scale={i.phyrexian ? 0.74 : 0.8} /></>
  } else {
    body = <><circle cx={16} cy={16} r={15} fill="var(--lk-mana-c)" /><Num t={i.generic ?? sym} /></>
  }
  return (
    <svg aria-label={`{${sym}}`} role="img" width={size} height={size} viewBox="-2 -1 35 35" style={{ display: 'inline-block', flex: 'none', verticalAlign: '-0.18em' }}>
      {shadow && <circle cx={14.6} cy={17.6} r={15.2} fill="#000" opacity={0.85} />}
      {body}
    </svg>
  )
})

export const ManaCost = memo(function ManaCost({ cost, size = 16 }: { cost: string; size?: number }) {
  const syms = parseCost(cost)
  if (!syms.length) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(1, size * 0.1) }}>
      {syms.map((s, i) => <ManaSymbol key={i} sym={s} size={size} />)}
    </span>
  )
})
