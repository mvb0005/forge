import type { CSSProperties, ReactNode } from 'react'
import type { CardDto } from '../protocol'

const MANA_VAR: Record<string, string> = {
  W: 'var(--color-mana-w)',
  U: 'var(--color-mana-u)',
  B: 'var(--color-mana-b)',
  R: 'var(--color-mana-r)',
  G: 'var(--color-mana-g)',
  C: 'var(--color-mana-c)',
}
const DARK_TEXT = new Set(['W', 'C'])

/** One mana / rules symbol like G, 2, X, W/U, G/P, T. */
export function Sym({ s, size }: { s: string; size: number }) {
  const parts = s.toUpperCase().split('/')
  const base: CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.62,
    lineHeight: 1,
    boxShadow: '0 0.5px 1.5px rgb(0 0 0 / 0.6), inset 0 -1px 0 rgb(0 0 0 / 0.2)',
  }
  if (parts[0] === 'T' || parts[0] === 'Q') {
    return (
      <span className="inline-grid place-items-center rounded-full bg-[#cfc8b8] text-[#1a1a1a] align-[-0.15em] font-bold" style={base}>
        <svg viewBox="0 0 16 16" width={size * 0.72} height={size * 0.72}>
          <path d={parts[0] === 'T' ? 'M3 4.5h7.5V2l3.5 3.5L10.5 9V6.5H5V13H3z' : 'M13 11.5H5.5V14L2 10.5 5.5 7v2.5H11V3h2z'} fill="currentColor" />
        </svg>
      </span>
    )
  }
  const colored = parts.filter((p) => p in MANA_VAR && p !== 'C')
  let bg = 'var(--color-mana-c)'
  if (colored.length === 1 && parts.length === 1) bg = MANA_VAR[colored[0]]
  else if (parts.length === 2 && parts[1] === 'P') bg = MANA_VAR[parts[0]] ?? bg
  else if (parts.length === 2) {
    const a = MANA_VAR[parts[0]] ?? 'var(--color-mana-c)'
    const b = MANA_VAR[parts[1]] ?? 'var(--color-mana-c)'
    bg = `linear-gradient(135deg, ${a} 50%, ${b} 50%)`
  } else if (parts[0] === 'C') bg = 'var(--color-mana-c)'
  const label = parts.length === 2 ? (parts[1] === 'P' ? 'φ' : '') : parts[0] === 'C' || colored.length ? '' : parts[0]
  const dark = parts.length === 1 && (DARK_TEXT.has(parts[0]) || !colored.length)
  return (
    <span
      className={`inline-grid place-items-center rounded-full font-bold align-[-0.15em] ${dark ? 'text-[#1a1a1a]' : 'text-white'}`}
      style={{ ...base, background: bg }}
      title={`{${s}}`}
    >
      {label || (colored.length === 1 && parts.length === 1 ? <ColorGlyph c={colored[0]} size={size} /> : parts[0] === 'C' ? <ColorGlyph c="C" size={size} /> : null)}
    </span>
  )
}

// Tiny monochrome glyphs inside coloured pips, so colour isn't the only signal.
function ColorGlyph({ c, size }: { c: string; size: number }) {
  const d: Record<string, string> = {
    W: 'M8 2.2l1.3 3.6 3.8.1-3 2.4 1.1 3.7L8 9.8 4.8 12l1.1-3.7-3-2.4 3.8-.1z',
    U: 'M8 2c2.4 3.2 3.8 5.3 3.8 7.2a3.8 3.8 0 0 1-7.6 0C4.2 7.3 5.6 5.2 8 2z',
    B: 'M8 2.5a4.6 4.4 0 0 0-4.6 4.4c0 1.6.8 2.6 1.7 3.2V12h1.4v-1.2h1v1.2h1v-1.2h1V12h1.4v-1.9c.9-.6 1.7-1.6 1.7-3.2A4.6 4.4 0 0 0 8 2.5zM6 6.4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zm4 0a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z',
    R: 'M8.6 1.8c.4 2.2-1.6 3-1.6 5 0 .7.4 1.2.9 1.4-.2-1 .5-1.7 1.2-2.4.6 1.6 2.4 2.5 2.4 4.6A3.5 3.5 0 0 1 8 14a3.5 3.5 0 0 1-3.5-3.6c0-3.5 3.6-4.6 4.1-8.6z',
    G: 'M8 1.8 12.3 8H10l2.6 3.6H8.8V14H7.2v-2.4H3.4L6 8H3.7z',
    C: 'M8 2.5 13 8l-5 5.5L3 8z',
  }
  return (
    <svg viewBox="0 0 16 16" width={size * 0.74} height={size * 0.74} aria-hidden>
      <path d={d[c]} fill="currentColor" opacity={c === 'B' ? 0.95 : 0.85} />
    </svg>
  )
}

export function parseSymbols(cost: string): string[] {
  return [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
}

export function ManaCost({ cost, size }: { cost: string; size: number }) {
  const syms = parseSymbols(cost)
  if (!syms.length) return null
  return (
    <span className="inline-flex shrink-0 items-center" style={{ gap: Math.max(1, size * 0.08) }}>
      {syms.map((s, i) => (
        <Sym key={i} s={s} size={size} />
      ))}
    </span>
  )
}

/** Rules text with {X} symbols drawn inline. */
export function RulesText({ text, size }: { text: string; size: number }): ReactNode {
  return text.split('\n').map((line, li) => (
    <p key={li} style={{ margin: 0, marginTop: li ? size * 0.35 : 0 }}>
      {line.split(/(\{[^}]+\})/g).map((part, i) =>
        part.startsWith('{') && part.endsWith('}') ? <Sym key={i} s={part.slice(1, -1)} size={size * 1.05} /> : <span key={i}>{part}</span>,
      )}
    </p>
  ))
}

const BASIC_COLOR: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G', Wastes: 'C' }

/** The colours a frame is tinted with: card colours, or for lands the mana they make. */
export function frameColors(card: CardDto): string[] {
  if (card.colors) return [...card.colors]
  if (card.types.includes('Land')) {
    const sub = Object.keys(BASIC_COLOR).filter((b) => card.typeLine.includes(b) || card.name === b)
    if (sub.length) return sub.map((b) => BASIC_COLOR[b])
    const made = new Set<string>()
    for (const m of card.text.matchAll(/Add ((?:\{[WUBRGC]\}(?: or )?)+)/g)) for (const s of m[1].matchAll(/\{([WUBRG])\}/g)) made.add(s[1])
    if (/any colou?r/i.test(card.text)) return ['M']
    return [...made]
  }
  return []
}

const TINT: Record<string, string> = {
  W: '#d9cfa8',
  U: '#3d7fc4',
  B: '#6e5a72',
  R: '#c9503c',
  G: '#2f8f55',
  C: '#8d969f',
  M: '#c9a640', // gold
  L: '#8a7356', // colourless land
}

/** Frame tint colour(s) for the text-frame fallback. */
export function frameTint(card: CardDto): [string, string] {
  const cs = frameColors(card)
  if (cs.length === 0) return card.types.includes('Land') ? [TINT.L, TINT.L] : [TINT.C, TINT.C]
  if (cs.length === 1) return [TINT[cs[0]], TINT[cs[0]]]
  if (cs.length === 2) return [TINT[cs[0]], TINT[cs[1]]]
  return [TINT.M, TINT.M]
}
