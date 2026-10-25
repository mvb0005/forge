import { memo } from 'react'

// Our own small icon set, 24×24 view box. `s` = stroked (2px) instead of filled.
export type Glyph = { d: string; s?: boolean }

function sunRays() {
  let d = 'M12 7.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8z'
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    const long = k % 2 === 0
    const r0 = 6.1, r1 = long ? 11 : 9.4, w = long ? 0.42 : 0.36
    const p = (r: number, t: number) => `${(12 + r * Math.sin(t)).toFixed(2)} ${(12 - r * Math.cos(t)).toFixed(2)}`
    d += `M${p(r0, a - w / 2.2)}L${p(r1, a)}L${p(r0, a + w / 2.2)}z`
  }
  return d
}

export const MANA_GLYPH: Record<string, Glyph> = {
  W: { d: sunRays() },
  U: { d: 'M12 2.6c3.5 4.7 6.2 8 6.2 11.6a6.2 6.2 0 0 1-12.4 0c0-3.6 2.7-6.9 6.2-11.6zm-2.6 10.6c-.6 1.9.2 3.6 1.7 4.3-2.4.1-3.5-2.4-1.7-4.3z' },
  B: { d: 'M12 2.8c-4.5 0-7.8 3.1-7.8 7.4 0 2.7 1.3 4.5 2.9 5.5v3.4h2.4v-1.9h1.5v1.9h2v-1.9h1.5v1.9h2.4v-3.4c1.6-1 2.9-2.8 2.9-5.5 0-4.3-3.3-7.4-7.8-7.4zM8.6 9.2a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zm6.8 0a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zM12 13.4l1.1 2h-2.2z' },
  R: { d: 'M12.4 2c.9 3.6 5.4 5.4 5.4 10.6a5.8 5.8 0 0 1-11.6 0c0-2.4 1.1-4 2.3-5.1-.1 2.2 1 3.4 2.2 3.6-1.1-3.4.3-6.4 1.7-9.1z' },
  G: { d: 'M12 1.8 5.6 11h3.1l-4.1 6.1h6.2V22h2.4v-4.9h6.2L15.3 11h3.1z' },
  C: { d: 'M12 3.2 20.8 12 12 20.8 3.2 12zm0 4.3L7.5 12l4.5 4.5 4.5-4.5z' },
  S: { d: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.6 3.8 12 6l2.4-2.2M9.6 20.2 12 18l2.4 2.2', s: true },
  P: { d: 'M12 6.2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6zM12 3v18', s: true },
  T: { d: 'M5 20V9.5C5 6 7.4 4 10.6 4H14V1.5L19.5 6 14 10.5V8h-3.2C9.6 8 9 8.7 9 10v10z' },
  Q: { d: 'M19 4v10.5c0 3.5-2.4 5.5-5.6 5.5H10v2.5L4.5 18 10 13.5V16h3.2c1.2 0 1.8-.7 1.8-2V4z' },
  E: { d: 'M13.5 2 5 13.5h6L9.8 22l9.2-12h-6z' },
}

export const KEYWORD_GLYPH: Record<string, Glyph> = {
  deathtouch: MANA_GLYPH.B,
  'first strike': { d: 'M14.5 3H20v5.5L9 19.5l-1.5 1.5-4-4L5 15.5zM5 15.5l3.5 3.5', s: true },
  'double strike': { d: 'M13 2.5h5.5V8L9.5 17M4 13.5l3.5 3.5M21.5 6.5V12l-9 9M8 17.5l3 3', s: true },
  trample: { d: 'M3 20 12 4l9 16h-4l-5-9-5 9z' },
  menace: { d: 'M3 4l4 6-4 6 4-1 2 5 3-5 3 5 2-5 4 1-4-6 4-6-5 3-4-4-4 4z' },
  infect: { d: 'M12 2c3 4.5 6 7.7 6 11.3A6 6 0 0 1 6 13.3C6 9.7 9 6.5 12 2zm0 8.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z' },
  lifelink: { d: 'M12 21s-8.5-5.3-8.5-11A4.9 4.9 0 0 1 12 7a4.9 4.9 0 0 1 8.5 3c0 5.7-8.5 11-8.5 11z' },
  hexproof: { d: 'M12 2 4 5v6c0 5 3.5 9.3 8 11 4.5-1.7 8-6 8-11V5zm0 4.5a3 3 0 0 1 1 5.8V16h-2v-3.7a3 3 0 0 1 1-5.8z' },
  shroud: { d: 'M12 2 4 5v6c0 5 3.5 9.3 8 11 4.5-1.7 8-6 8-11V5zM8 9.5l8 7M16 9.5l-8 7', s: true },
  indestructible: { d: 'M12 2 3 7v10l9 5 9-5V7zm0 4 5 2.8v6.4L12 18l-5-2.8V8.8z' },
  ward: { d: 'M12 2 4 5v6c0 5 3.5 9.3 8 11 4.5-1.7 8-6 8-11V5z' },
  protection: { d: 'M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6zM8.5 12l2.5 2.5 4.5-5', s: true },
  flying: { d: 'M2 14c4-1 7-4 9-9 .5 4-1 7-3 9 3-.5 6-2.5 8-6-.2 4-2.6 7-6 8.5 2.5.3 5-.6 7-2.5-1.6 3.7-5.4 5.5-9.5 5-2.2-.3-4-1.8-5.5-5z' },
  reach: { d: 'M12 2v20M12 2 6 8M12 2l6 6M5 14l7-4 7 4', s: true },
  "can't be blocked": { d: 'M4 12h12M12 6l6 6-6 6', s: true },
  haste: { d: 'M13 2 4 14h6l-1 8 9-12h-6z' },
  vigilance: { d: 'M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12zm10.5 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z' },
  defender: { d: 'M3 5h18v4H3zM3 11h8v4H3zm10 0h8v4h-8zM3 17h18v3H3z' },
}

export const MARK_GLYPH: Record<string, Glyph> = {
  sick: { d: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2', s: true },
  lock: { d: 'M7 10V7.5a5 5 0 0 1 10 0V10h1.5v11h-13V10zm2.5 0h5V7.5a2.5 2.5 0 0 0-5 0z' },
  dies: MANA_GLYPH.B,
  survives: { d: 'M5 12l5 5 9-10', s: true },
  tapped: MANA_GLYPH.T,
  frozen: { d: 'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7', s: true },
  goad: { d: 'M12 2l2.6 6.6L21 9.3l-5 4.4L17.5 21 12 17.3 6.5 21 8 13.7l-5-4.4 6.4-.7z' },
  trigger: { d: 'M13 2 4 14h6l-1 8 9-12h-6z' },
  block: { d: 'M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z', s: true },
  warn: { d: 'M12 3l9 16H3zM12 10v4M12 17v.5', s: true },
}

export const Icon = memo(function Icon({ g, size, color = 'currentColor', sw = 2 }: { g: Glyph; size: number; color?: string; sw?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', flex: 'none' }}>
      <path
        d={g.d}
        fill={g.s ? 'none' : color}
        fillRule="evenodd"
        stroke={g.s ? color : 'none'}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
})
