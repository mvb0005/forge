// Small inline SVG icons (24×24 viewBox, currentColor).

const KW: Record<string, string> = {
  flying: 'M2 14c4-1 7-4 9-9 .5 4-1 7-3 9 3-.5 6-2.5 8-6-.2 4-2.6 7-6 8.5 2.5.3 5-.6 7-2.5-1.6 3.7-5.4 5.5-9.5 5-2.2-.3-4-1.8-5.5-5z',
  reach: 'M12 2v20M12 2 6 8M12 2l6 6M5 14l7-4 7 4M5 20l7-4 7 4',
  deathtouch:
    'M12 2.5c-4.6 0-8 3.2-8 7.6 0 2.8 1.3 4.6 3 5.6V19h2.5v-2h1.5v2h2v-2h1.5v2H17v-3.3c1.7-1 3-2.8 3-5.6 0-4.4-3.4-7.6-8-7.6zM8.5 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  trample: 'M3 20 12 4l9 16h-4l-5-9-5 9z',
  lifelink: 'M12 21s-8.5-5.3-8.5-11A4.9 4.9 0 0 1 12 7a4.9 4.9 0 0 1 8.5 3c0 5.7-8.5 11-8.5 11z',
  'first strike': 'M14.5 3H20v5.5L9 19.5l-1.5 1.5-4-4L5 15.5zM5 15.5l3.5 3.5',
  'double strike': 'M13 3h5v5L9.5 16.5 7.5 14.5zM21 9v5l-8.5 8.5-2-2zM4 16l4 4',
  vigilance: 'M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12zm10.5 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  menace: 'M3 4l4 6-4 6 4-1 2 5 3-5 3 5 2-5 4 1-4-6 4-6-5 3-4-4-4 4z',
  haste: 'M13 2 4 14h6l-1 8 9-12h-6z',
  hexproof: 'M12 2 4 5v6c0 5 3.5 9.3 8 11 4.5-1.7 8-6 8-11V5zm0 4.5a3 3 0 0 1 1 5.8V16h-2v-3.7a3 3 0 0 1 1-5.8z',
  indestructible: 'M12 2 3 7v10l9 5 9-5V7zm0 4 5 2.8v6.4L12 18l-5-2.8V8.8z',
  infect: 'M12 2c3 4.5 6 7.7 6 11.3A6 6 0 0 1 6 13.3C6 9.7 9 6.5 12 2zm-2.5 11a1.5 1.5 0 1 0 0 .1zm5 2a1.2 1.2 0 1 0 0 .1z',
  ward: 'M12 2 4 5v6c0 5 3.5 9.3 8 11 4.5-1.7 8-6 8-11V5zM8 9l1.3 6h1.4L12 11l1.3 4h1.4L16 9h-1.6l-.7 3.6L12.6 9h-1.2l-1.1 3.6L9.6 9z',
  defender: 'M3 6h18v4H3zM3 12h8v4H3zm10 0h8v4h-8zM3 18h18v3H3z',
}
const STROKE = new Set(['reach', 'first strike', 'double strike'])

export const KEYWORD_ORDER = [
  'flying',
  'reach',
  'first strike',
  'double strike',
  'deathtouch',
  'trample',
  'lifelink',
  'menace',
  'vigilance',
  'haste',
  'hexproof',
  'ward',
  'indestructible',
  'infect',
  'defender',
]

export function KeywordIcon({ k, size }: { k: string; size: number }) {
  const d = KW[k]
  if (!d) return null
  const stroke = STROKE.has(k)
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-label={k}>
      <title>{k}</title>
      <path
        d={d}
        fill={stroke ? 'none' : 'currentColor'}
        stroke={stroke ? 'currentColor' : 'none'}
        strokeWidth={stroke ? 2.6 : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
        fillRule="evenodd"
      />
    </svg>
  )
}

export const Icon = {
  clock: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s} aria-label="summoning sick">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M12 7v5.5l3.5 2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ),
  exile: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s} aria-label="exiled cards">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" fill="currentColor" fillRule="evenodd" />
    </svg>
  ),
  library: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s}>
      <path d="M6 3h12a1 1 0 0 1 1 1v14H7a2 2 0 0 0 0 4h12v-1M5 19V5a2 2 0 0 1 1-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
  graveyard: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s}>
      <path d="M6 21V10a6 6 0 0 1 12 0v11zM12 8v6M9.5 10.5h5M3 21h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  hand: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s}>
      <rect x="3" y="6" width="9" height="13" rx="1.5" transform="rotate(-12 7.5 12.5)" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="11" y="4" width="9" height="13" rx="1.5" transform="rotate(10 15.5 10.5)" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  command: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s}>
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
  poison: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s}>
      <path d="M12 2c3 4.5 6 7.7 6 11.3A6 6 0 0 1 6 13.3C6 9.7 9 6.5 12 2z" fill="currentColor" />
    </svg>
  ),
  sword: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s}>
      <path d="M14.5 3H20v5.5L9 19.5M5 15.5 14.5 6M4 16l4 4M3 21l2-2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  shield: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s}>
      <path d="M12 2 4 5v6c0 5 3.5 9.3 8 11 4.5-1.7 8-6 8-11V5z" fill="currentColor" />
    </svg>
  ),
  bolt: (s: number) => (
    <svg viewBox="0 0 24 24" width={s} height={s}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor" />
    </svg>
  ),
}

/** Big faint glyph in the art box of a text-frame card, by card type. */
export function TypeGlyph({ types, size }: { types: string[]; size: number }) {
  const t = types.includes('Creature')
    ? 'creature'
    : types.includes('Planeswalker')
      ? 'pw'
      : types.includes('Land')
        ? 'land'
        : types.includes('Instant')
          ? 'instant'
          : types.includes('Sorcery')
            ? 'sorcery'
            : types.includes('Artifact')
              ? 'artifact'
              : types.includes('Enchantment')
                ? 'ench'
                : types.includes('Battle')
                  ? 'battle'
                  : 'other'
  const paths: Record<string, string> = {
    creature: 'M5 20c1-6 2-10 1-15l3 4 1-6 2 6 2-6 1 6 3-4c-1 5 0 9 1 15z',
    pw: 'M12 2 9 9H2l5.5 4.5L5 21l7-4.5 7 4.5-2.5-7.5L22 9h-7z',
    land: 'M1 20 8 8l4 6 3-4 8 10z',
    instant: 'M13 2 4 14h6l-1 8 9-12h-6z',
    sorcery: 'M12.5 2c.6 3.3-2.4 4.5-2.4 7.5 0 1 .6 1.8 1.4 2.1-.3-1.5.7-2.6 1.8-3.6.9 2.4 3.6 3.8 3.6 6.9A5 5 0 0 1 12 20a5 5 0 0 1-5-5.1c0-5.2 5.2-6.9 5.5-12.9z',
    artifact: 'M10 2h4l.6 2.6 2.3 1 2.3-1.4 2.8 2.8-1.4 2.3 1 2.3L24 12v0l-2.4.6-1 2.3 1.4 2.3-2.8 2.8-2.3-1.4-2.3 1L14 22h-4l-.6-2.4-2.3-1-2.3 1.4L2 17.2l1.4-2.3-1-2.3L0 12l2.4-.6 1-2.3L2 6.8 4.8 4l2.3 1.4 2.3-1zm2 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    ench: 'M12 1l2 7 7 2-7 2-2 7-2-7-7-2 7-2zM19 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1z',
    battle: 'M12 2 4 5v6c0 5 3.5 9.3 8 11 4.5-1.7 8-6 8-11V5z',
    other: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d={paths[t]} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
