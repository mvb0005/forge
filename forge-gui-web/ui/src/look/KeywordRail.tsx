import { memo } from 'react'
import './theme'
import { KEYWORDS, type KeywordTier } from '../popover/keywords'
import { Icon, KEYWORD_GLYPH, MARK_GLYPH } from './glyphs'

const RING: Record<KeywordTier, string> = {
  1: '0 0 0 2px var(--lk-ember), 0 0 10px var(--lk-ember-soft), 0 3px 6px rgb(0 0 0 / .6)',
  2: '0 0 0 1.5px var(--lk-steel), 0 3px 6px rgb(0 0 0 / .6)',
  3: '0 0 0 1.5px var(--lk-metal-ring), 0 3px 6px rgb(0 0 0 / .6)',
  4: '0 0 0 1px var(--lk-metal-line), 0 3px 6px rgb(0 0 0 / .6)',
}
const INK: Record<KeywordTier, string> = { 1: 'var(--lk-ember-text)', 2: 'var(--lk-steel-text)', 3: 'var(--lk-parchment)', 4: 'var(--lk-parchment-dim)' }
const WORD: Record<KeywordTier, string> = { 1: 'var(--lk-ember-light)', 2: 'var(--lk-steel-text)', 3: 'var(--lk-parchment)', 4: 'var(--lk-parchment-dim)' }

/** The keywords a rail shows (tiers 1–3, known ones only), danger first. Tier 4 are corner marks. */
export function railKeywords(keywords: string[]) {
  return keywords
    .map((k) => k.toLowerCase())
    .filter((k) => KEYWORDS[k] && KEYWORDS[k].tier < 4)
    .sort((a, b) => KEYWORDS[a].tier - KEYWORDS[b].tier)
}

/**
 * Keyword icons down a card's left edge. Tier 1 shows its word, the rest show words on hover.
 * `choosingTargets` swaps protected keywords' icons for a lock (DESIGN.md tier 2).
 */
export const KeywordRail = memo(function KeywordRail({ keywords, size = 26, choosingTargets = false, words = true }: {
  keywords: string[]
  size?: number
  choosingTargets?: boolean
  words?: boolean
}) {
  const ks = railKeywords(keywords)
  if (!ks.length) return null
  return (
    <span className="lk-rail" style={{ display: 'flex', flexDirection: 'column', gap: size * 0.18 }}>
      {ks.map((k) => {
        const info = KEYWORDS[k]
        const g = choosingTargets && info.tier === 2 ? MARK_GLYPH.lock : KEYWORD_GLYPH[k]
        return (
          <span key={k} title={`${info.label}: ${info.rule}`} style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
            <span
              className="lk-rail-word lk-text"
              data-on={words && info.tier === 1 ? '1' : '0'}
              style={{
                position: 'absolute', left: size * 0.5, top: size * 0.12, height: size * 0.76, display: 'flex', alignItems: 'center',
                paddingLeft: size * 0.62, paddingRight: size * 0.36, borderRadius: `0 ${size}px ${size}px 0`, background: 'var(--lk-chip)',
                boxShadow: `inset 0 0 0 1px ${info.tier === 1 ? 'var(--lk-ember-line)' : 'var(--lk-metal-line)'}`,
                color: WORD[info.tier], fontSize: size * 0.52, fontWeight: 700, whiteSpace: 'nowrap',
              }}
            >
              {info.label}
            </span>
            <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--lk-ink-2)', display: 'grid', placeItems: 'center', boxShadow: RING[info.tier] }}>
              <Icon g={g ?? MARK_GLYPH.warn} size={size * 0.6} color={INK[info.tier]} />
            </span>
          </span>
        )
      })}
    </span>
  )
})
