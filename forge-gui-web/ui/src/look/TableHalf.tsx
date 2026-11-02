import { memo, type CSSProperties, type ReactNode } from 'react'
import type { Mat, Metal } from './theme'
import { toneBackground } from './tones'

const fill: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }

/**
 * One player's half of the table, in their colour identity (flat tones, D-05; bands in tones.ts).
 * The active player's half is brighter (an opacity cross-fade). Other playmats replace the tones via tokens.
 */
export const TableHalf = memo(function TableHalf({ colors, active = false, side = 'bottom', style, children }: {
  colors: string
  active?: boolean
  side?: 'top' | 'bottom'
  style?: CSSProperties
  children?: ReactNode
}) {
  const toward = side === 'top' ? '100%' : '0%'
  return (
    <div className="lk-half" data-side={side} style={{ position: 'relative', overflow: 'hidden', ...style }}>
      <div style={{ ...fill, background: toneBackground(colors), opacity: 'var(--lk-mat-tones)' as unknown as number }} />
      <div className="lk-half-hi" style={{ ...fill, background: toneBackground(colors, true), opacity: active ? ('var(--lk-mat-tones)' as unknown as number) : 0 }} />
      <div style={{ ...fill, background: 'var(--lk-mat-half)' }} />
      <div className="lk-half-hi" style={{ ...fill, background: `radial-gradient(ellipse 70% 90% at 50% ${toward}, var(--lk-lamp), transparent 70%)`, opacity: active ? 1 : 0.35 }} />
      {children}
    </div>
  )
})

/** The table root: playmat and metal token sets; `halves` under the vignette, `children` (cards, chrome) over it. */
export function TableMat({ mat = 'identity', metal = 'gold', halves, style, children }: { mat?: Mat; metal?: Metal; halves?: ReactNode; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div data-mat={mat} data-metal={metal} className="lk-text" style={{ position: 'relative', overflow: 'hidden', background: 'var(--lk-mat-room)', color: 'var(--lk-parchment)', ...style }}>
      {halves}
      <div style={{ ...fill, background: 'var(--lk-mat-vignette)' }} />
      {children}
    </div>
  )
}
