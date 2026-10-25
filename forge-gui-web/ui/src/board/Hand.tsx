import { useRef, useState, type CSSProperties } from 'react'
import type { CardDto } from '../protocol'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { CARD_RATIO } from './layout'
import { clickCards, useHighlight } from './Tile'
import { useSize } from './useSize'

/** Your hand: fanned and overlapped along the bottom; the hovered card rises. */
export function Hand({ cards }: { cards: CardDto[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const { W, H } = useSize(ref)
  const [hover, setHover] = useState<number | null>(null)
  const n = cards.length
  const cw = Math.max(60, Math.min(170, (H + 18) / CARD_RATIO))
  const ch = cw * CARD_RATIO
  const step = n > 1 ? Math.min(cw * 0.9, (W - cw - 16) / (n - 1)) : 0
  const total = (n - 1) * step + cw
  const x0 = (W - total) / 2
  const mid = (n - 1) / 2
  const tilt = Math.min(3.2, 18 / Math.max(1, n))
  return (
    <div ref={ref} className="relative h-full w-full">
      {cards.map((c, i) => {
        const d = i - mid
        const up = hover === i
        const x = x0 + i * step + (hover != null && !up ? (i < hover ? -1 : 1) * Math.min(cw * 0.18, Math.max(0, cw * 0.9 - step) * 0.5) : 0)
        const y = up ? H - ch - 28 : 6 + d * d * 0.9
        return (
          <HandCard
            key={c.id}
            card={c}
            w={cw}
            style={{
              transform: `translate(${x}px, ${y}px) rotate(${up ? 0 : d * tilt}deg) scale(${up ? 1.16 : 1})`,
              zIndex: up ? 100 : i,
            }}
            onEnter={() => setHover(i)}
            onLeave={() => setHover((h) => (h === i ? null : h))}
          />
        )
      })}
    </div>
  )
}

function HandCard({ card, w, style, onEnter, onLeave }: { card: CardDto; w: number; style: CSSProperties; onEnter: () => void; onLeave: () => void }) {
  const { ring, dim } = useHighlight([card.id])
  return (
    <div
      data-entity={`card:${card.id}`}
      className={`bf-card absolute left-0 top-0 origin-bottom cursor-pointer rounded-[7px] ${ring} ${dim ? 'hl-dim' : ''}`}
      style={{ ...style, transition: 'transform 160ms ease-out, filter 160ms, box-shadow 160ms' }}
      onMouseEnter={() => {
        useForge.getState().setHovered(card.id)
        onEnter()
      }}
      onMouseLeave={() => {
        useForge.getState().setHovered(null)
        onLeave()
      }}
      onClick={(e) => clickCards(e, [card.id])}
      onContextMenu={(e) => clickCards(e, [card.id])}
    >
      <CardImage card={card} width={w} />
    </div>
  )
}
