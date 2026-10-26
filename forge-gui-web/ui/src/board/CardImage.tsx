import { memo, useState, type CSSProperties } from 'react'
import type { CardDto } from '../protocol'
import { TypeGlyph } from './icons'
import { ManaCost, RulesText, frameTint } from './mana'
import { CARD_RATIO } from './layout'

const INK = '#0b0f13'
const mix = (c: string, pct: number, base = INK) => `color-mix(in oklab, ${c} ${pct}%, ${base})`

/**
 * The one way to draw a full card face. Uses `card.img` when present (lazy, the text frame shows
 * while it loads or if it fails). `bare` = battlefield use: no P/T box (the tile overlays one), and
 * small widths become an art crop with a name strip.
 */
export const CardImage = memo(function CardImage({ card, width, bare = false, mini = false }: { card: CardDto; width: number; bare?: boolean; mini?: boolean }) {
  const h = Math.round(width * CARD_RATIO)
  const radius = Math.max(3, width * 0.048)
  if (card.hidden) return <CardBack width={width} />
  const small = bare && width < 110
  const miniFrame = small || (mini && !card.img)
  return (
    <div
      className="relative overflow-hidden select-none"
      style={{ width, height: h, borderRadius: radius, background: INK, boxShadow: '0 1px 3px rgb(0 0 0 / 0.55)' }}
    >
      {miniFrame ? <MiniFrame card={card} width={width} height={h} /> : <TextFrame card={card} width={width} height={h} bare={bare} />}
      {card.img && <CardImg key={card.img} src={card.img} width={width} height={h} crop={small} name={card.name} />}
    </div>
  )
})

function CardImg({ src, width, height, crop, name }: { src: string; width: number; height: number; crop: boolean; name: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  if (state === 'error') return null
  let style: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }
  if (crop) {
    // Fill the area below the name strip with the art box (≈ x 8.5–91.5 %, y 11.5–55.5 % of a card).
    const artH = height * 0.8
    const ih = artH / 0.44
    const iw = ih / CARD_RATIO
    style = { position: 'absolute', height: ih, width: iw, maxWidth: 'none', top: -0.115 * ih, left: -(0.085 * iw + (0.83 * iw - width) / 2) }
  }
  const img = (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setState('ok')}
      onError={() => setState('error')}
      style={{ ...style, opacity: state === 'ok' ? 1 : 0, transition: 'opacity 160ms ease-out' }}
    />
  )
  if (!crop) return img
  const fs = Math.max(8.5, Math.min(13, width * 0.13))
  return (
    <>
      <div className="absolute inset-x-0 bottom-0 overflow-hidden" style={{ height: height * 0.8 }}>
        {img}
      </div>
      {state === 'ok' && (
        <div
          className="absolute inset-x-0 top-0 flex items-center font-semibold leading-[1.1] text-ink"
          style={{ height: height * 0.2, fontSize: fs, padding: `0 ${fs * 0.35}px`, background: '#0b0f13' }}
        >
          <span className="line-clamp-2 break-words">{name}</span>
        </div>
      )}
    </>
  )
}

function bg(card: CardDto) {
  const [a, b] = frameTint(card)
  return `linear-gradient(155deg, ${mix(a, 62)} 0%, ${mix(b, 38)} 100%)`
}

function artBg(card: CardDto) {
  const [a, b] = frameTint(card)
  return `radial-gradient(120% 90% at 30% 20%, ${mix(a, 55, '#1d242c')} 0%, ${mix(b, 28)} 75%)`
}

function MiniFrame({ card, width, height }: { card: CardDto; width: number; height: number }) {
  const fs = Math.max(8.5, Math.min(13, width * 0.13))
  const [a] = frameTint(card)
  return (
    <div className="absolute inset-0" style={{ background: bg(card), padding: Math.max(2, width * 0.04) }}>
      <div
        className="relative grid h-full place-items-center overflow-hidden"
        style={{ background: artBg(card), borderRadius: Math.max(2, width * 0.03), color: mix(a, 30, '#ffffff') }}
      >
        <div style={{ opacity: 0.32, marginTop: height * 0.14 }}>
          <TypeGlyph types={card.types} size={width * 0.5} />
        </div>
        <div
          className="absolute inset-x-0 top-0 font-semibold leading-[1.1] text-ink"
          style={{ fontSize: fs, padding: `${fs * 0.3}px ${fs * 0.35}px ${fs * 0.5}px`, background: 'linear-gradient(rgb(6 9 12 / 0.92) 65%, transparent)' }}
        >
          <span className="line-clamp-2 break-words">{card.faceDown ? 'Face-down' : card.name}</span>
        </div>
        {card.token && <TokenTag size={fs * 0.75} bottom />}
      </div>
    </div>
  )
}

function TokenTag({ size, bottom = false }: { size: number; bottom?: boolean }) {
  return (
    <span
      className={`absolute left-1/2 ${bottom ? 'bottom-[26%]' : 'top-[3%]'} -translate-x-1/2 rounded-full font-semibold uppercase tracking-wider text-ink/80`}
      style={{ fontSize: size, padding: `0 ${size * 0.6}px`, background: 'rgb(6 9 12 / 0.55)' }}
    >
      token
    </span>
  )
}

function TextFrame({ card, width, height, bare }: { card: CardDto; width: number; height: number; bare: boolean }) {
  const pad = width * 0.04
  const nameFs = Math.max(8, Math.min(19, width * 0.066))
  const typeFs = Math.max(7, Math.min(15, width * 0.054))
  const textBoxH = height * 0.34
  const textBoxW = width - pad * 2
  const chars = Math.max(1, card.text.length)
  const fit = Math.sqrt((textBoxH * textBoxW * 0.82) / (chars * 0.88)) // Libre Baskerville runs wide
  const textFs = Math.max(6, Math.min(width * 0.056, 15, fit * 0.98))
  const [a, b] = frameTint(card)
  const bar: CSSProperties = {
    background: 'linear-gradient(180deg, rgb(8 11 15 / 0.62), rgb(8 11 15 / 0.78))',
    borderRadius: width * 0.025,
    boxShadow: `inset 0 0 0 1px ${mix(a, 45, '#ffffff22')}`,
  }
  const stat = card.types.includes('Planeswalker') ? card.loyalty : card.types.includes('Battle') ? card.defense : null
  const showPT = !bare && card.power != null && card.toughness != null
  const name = card.faceDown ? 'Face-down card' : card.name
  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: bg(card), padding: pad, gap: pad * 0.55 }}>
      <div className="flex items-center justify-between" style={{ ...bar, padding: `${nameFs * 0.22}px ${nameFs * 0.4}px`, gap: 4 }}>
        <span className="truncate font-title font-bold text-ink" style={{ fontSize: nameFs, lineHeight: 1.15 }}>
          {name}
        </span>
        <ManaCost cost={card.manaCost} size={nameFs * 0.95} />
      </div>
      <div
        className="relative grid min-h-0 flex-1 place-items-center overflow-hidden"
        style={{ background: artBg(card), borderRadius: width * 0.02, color: mix(b, 30, '#ffffff'), boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.35)' }}
      >
        <div style={{ opacity: 0.3 }}>
          <TypeGlyph types={card.types} size={Math.min(width * 0.36, height * 0.2)} />
        </div>
        {card.token && <TokenTag size={typeFs * 0.8} />}
      </div>
      <div className="truncate text-ink" style={{ ...bar, fontSize: typeFs, padding: `${typeFs * 0.25}px ${typeFs * 0.5}px`, lineHeight: 1.2 }}>
        {card.typeLine || card.types.join(' ')}
      </div>
      <div
        className="relative overflow-hidden text-ink/90"
        style={{
          height: textBoxH,
          flexShrink: 0,
          fontSize: textFs,
          lineHeight: 1.25,
          padding: `${textFs * 0.4}px ${textFs * 0.55}px`,
          paddingBottom: showPT || stat != null ? textFs * 1.6 : textFs * 0.4,
          background: 'rgb(8 11 15 / 0.5)',
          borderRadius: width * 0.025,
        }}
      >
        <RulesText text={card.text} size={textFs} />
      </div>
      {(showPT || (!bare && stat != null)) && (
        <div
          className="absolute font-bold text-ink"
          style={{
            right: pad * 1.2,
            bottom: pad * 0.9,
            fontSize: nameFs * 1.05,
            padding: `${nameFs * 0.1}px ${nameFs * 0.45}px`,
            background: '#0e1318',
            borderRadius: width * 0.03,
            boxShadow: `inset 0 0 0 1.5px ${mix(a, 70, '#ffffff')}`,
          }}
        >
          {showPT ? `${card.power}/${card.toughness}` : stat}
        </div>
      )}
    </div>
  )
}

export function CardBack({ width }: { width: number }) {
  const h = Math.round(width * CARD_RATIO)
  return (
    <div
      className="relative grid place-items-center overflow-hidden select-none"
      style={{
        width,
        height: h,
        borderRadius: Math.max(3, width * 0.048),
        background: 'radial-gradient(70% 55% at 50% 50%, #3a2a1c 0%, #22170f 60%, #140e09 100%)',
        boxShadow: 'inset 0 0 0 ' + Math.max(2, width * 0.045) + 'px #1b130c, 0 1px 3px rgb(0 0 0 / 0.55)',
      }}
    >
      <div
        style={{
          width: width * 0.62,
          height: h * 0.6,
          borderRadius: '50%',
          border: `${Math.max(1.5, width * 0.03)}px solid #a4793f`,
          background: 'radial-gradient(circle, #5a3d22 0%, #2b1d11 70%)',
          boxShadow: '0 0 12px rgb(164 121 63 / 0.35)',
        }}
      />
    </div>
  )
}
