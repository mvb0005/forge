import { memo, type CSSProperties } from 'react'
import './theme'
import { CardImage } from '../board/CardImage'
import { KEYWORDS } from '../popover/keywords'
import type { CardDto } from '../protocol'
import { CounterGem, counterKind } from './CounterGem'
import { Icon, KEYWORD_GLYPH, MARK_GLYPH, type Glyph } from './glyphs'
import { KeywordRail } from './KeywordRail'
import { StatShield } from './LifeShield'
import { PTPlate, type BasePT } from './PTPlate'

/** Design size: every card face is laid out once at this width and scaled to the layer's width. */
export const DESIGN_W = 160
export const DESIGN_H = Math.round((DESIGN_W * 88) / 63)
const k0 = DESIGN_H / DESIGN_W

export type Highlight = 'playable' | 'choose' | 'chosen' | 'attacking' | 'blocking' | 'targeted'

export const RING: Record<Highlight, string> = {
  playable: '0 0 0 2.5px var(--lk-frost), 0 0 22px 4px var(--lk-frost-soft)',
  choose: '0 0 0 2.5px var(--lk-gold)',
  chosen: '0 0 0 2px var(--lk-ink), 0 0 0 5.5px var(--lk-brass), 0 0 16px 3px var(--lk-brass-soft)',
  attacking: '0 0 0 2.5px var(--lk-ember), 0 0 28px 6px var(--lk-ember-soft)',
  blocking: '0 0 0 2.5px var(--lk-steel), 0 0 24px 4px var(--lk-steel-soft)',
  targeted: '0 0 0 3px var(--lk-ember), 0 0 30px 8px var(--lk-ember-soft)',
}

const R = 8 // corner radius at design size
const fill: CSSProperties = { position: 'absolute', inset: 0, borderRadius: R }

function Mark({ g, title, color = 'var(--lk-parchment-dim)', ring = 'var(--lk-metal-line)' }: { g: Glyph; title: string; color?: string; ring?: string }) {
  return (
    <span title={title} style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--lk-chip)', display: 'grid', placeItems: 'center', boxShadow: `0 0 0 1px ${ring}, 0 2px 4px rgb(0 0 0 / .6)` }}>
      <Icon g={g} size={14} color={color} />
    </span>
  )
}

export type CardFrameProps = {
  card: CardDto
  width: number
  art?: string | null // defaults to card.img
  highlight?: Highlight | null
  dim?: string | null // why it's greyed out (shown on hover)
  base?: BasePT | null // printed P/T, when the server sends it
  choosingTargets?: boolean
  verdict?: 'dies' | 'survives' | null
  count?: number // token group size
  rotate?: boolean // turn the face a quarter when tapped (off when the layer rotates the slot)
  words?: boolean // keyword words on the rail; defaults to whether the card is drawn large enough to read them
  mini?: boolean // a card without art draws its short text frame (it's too small to read rules text)
}

/**
 * The battlefield card skin: art, keyword rail, counter gem, P/T plate, status marks, highlight ring.
 * The outer box is `width` wide; the face is laid out at DESIGN_W and scaled, so a new width is a transform.
 */
export const CardFrame = memo(function CardFrame({ card, width, art, highlight = null, dim = null, base = null, choosingTargets = false, verdict = null, count = 1, rotate = false, words, mini = false }: CardFrameProps) {
  const k = width / DESIGN_W
  const src = art === undefined ? card.img : art
  const pw = card.types.includes('Planeswalker') && card.loyalty != null
  const battle = card.types.includes('Battle') && card.defense != null
  const counters = Object.entries(card.counters).filter(([n, c]) => c > 0 && counterKind(n) !== 'loyalty')
  const status = card.keywords.filter((kw) => KEYWORDS[kw]?.tier === 4)
  const tapped = card.tapped && !rotate && highlight !== 'attacking'
  const upright: CSSProperties | undefined = rotate ? { transform: card.tapped ? 'rotate(-90deg)' : undefined } : undefined
  return (
    <div className="lk-card" style={{ width, height: width * k0 }} title={dim ?? undefined}>
      <div className="lk-card-in" style={{ width: DESIGN_W, height: DESIGN_H, transform: `translate(${(width - DESIGN_W) / 2}px, ${(width * k0 - DESIGN_H) / 2}px) scale(${k})` }}>
       <div className="lk-tap" style={{ position: 'absolute', inset: 0, transform: rotate && card.tapped ? 'rotate(90deg)' : undefined }}>
        <div style={{ ...fill, overflow: 'hidden', background: 'var(--lk-ink-2)', boxShadow: `0 0 0 1px rgb(0 0 0 / .85), 0 6px 14px rgb(0 0 0 / .55)${highlight && highlight !== 'choose' ? ', ' + RING[highlight] : ''}` }}>
          {src ? (
            <img src={src} alt={card.name} draggable={false} decoding="async" loading="lazy" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <CardImage card={card} width={DESIGN_W} bare mini={mini} />
          )}
          {(dim || card.sick || tapped) && <span style={{ ...fill, borderRadius: 0, background: dim ? 'var(--lk-shade-dim)' : 'var(--lk-shade)' }} />}
        </div>
        {highlight === 'choose' && (
          <>
            <span style={{ ...fill, boxShadow: RING.choose }} />
            <span className="lk-breathe" style={{ ...fill, boxShadow: '0 0 0 3px var(--lk-gold), 0 0 30px 8px var(--lk-gold-soft)' }} />
          </>
        )}

        <span style={{ position: 'absolute', left: -9, top: 26 }}>
          <KeywordRail keywords={card.keywords} labels={card.keywordLabels} size={28} choosingTargets={choosingTargets} words={words ?? k >= 0.66} />
        </span>
        {counters.length > 0 && (
          <span className="lk-tap" style={{ position: 'absolute', left: -7, top: -8, display: 'flex', gap: 3, ...upright }}>
            {counters.map(([n, c]) => <CounterGem key={n} name={n} count={c} size={15} />)}
          </span>
        )}
        <span style={{ position: 'absolute', right: -8, top: 28, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {card.sick && <Mark g={MARK_GLYPH.sick} title="Summoning sick: arrived this turn" />}
          {status.map((s) => <Mark key={s} g={KEYWORD_GLYPH[s]} title={KEYWORDS[s].label} />)}
          {tapped && <Mark g={MARK_GLYPH.tapped} title="Tapped" />}
        </span>
        {verdict && (
          <span
            title={verdict === 'dies' ? 'Dies' : 'Survives'}
            style={{
              position: 'absolute', right: -14, top: 36, width: 38, height: 38, borderRadius: 999, background: 'var(--lk-ink-2)', display: 'grid', placeItems: 'center',
              boxShadow: `0 0 0 2.5px ${verdict === 'dies' ? 'var(--lk-ember)' : 'var(--lk-steel)'}, 0 4px 10px rgb(0 0 0 / .7)`,
            }}
          >
            <Icon g={verdict === 'dies' ? MARK_GLYPH.dies : MARK_GLYPH.survives} size={22} color={verdict === 'dies' ? 'var(--lk-ember-text)' : 'var(--lk-steel-text)'} sw={2.6} />
          </span>
        )}
        {count > 1 && (
          <span className="lk-title" style={{ position: 'absolute', left: 10, bottom: 10, padding: '0 9px', borderRadius: 999, background: 'var(--lk-chip)', boxShadow: '0 0 0 1px var(--lk-metal)', color: 'var(--lk-parchment)', fontWeight: 900, fontSize: 17, lineHeight: '24px' }}>
            ×{count}
          </span>
        )}
        <span className="lk-tap" style={{ position: 'absolute', right: -7, bottom: -7, ...upright }}>
          {pw ? <StatShield value={card.loyalty!} size={40} /> : battle ? <StatShield value={card.defense!} size={40} kind="defense" /> : card.power != null && card.toughness != null ? <PTPlate power={card.power} toughness={card.toughness} damage={card.damage} base={base} size={19} /> : null}
        </span>
       </div>
      </div>
    </div>
  )
})
