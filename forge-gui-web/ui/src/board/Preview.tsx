import { useEffect, useRef, useState } from 'react'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { KEYWORD_ORDER, KeywordIcon } from './icons'
import { useSize } from './useSize'

/** Fixed panel on the right edge: the hovered card, large, plus the game log. */
export function PreviewPanel() {
  const hovered = useForge((s) => s.hoveredCardId)
  const [last, setLast] = useState<number | null>(null)
  if (hovered != null && hovered !== last) setLast(hovered)
  const id = hovered ?? last
  const card = useForge((s) => (id != null ? s.cards[id] : undefined))
  const cards = useForge((s) => s.cards)
  const players = useForge((s) => s.players)
  const ref = useRef<HTMLDivElement>(null)
  const { W } = useSize(ref)
  const cw = Math.max(160, W)

  const facts: string[] = []
  if (card && !card.hidden) {
    if (card.tapped) facts.push('Tapped')
    if (card.sick) facts.push('Summoning sick')
    if (card.phasedOut) facts.push('Phased out')
    if (card.token) facts.push('Token')
    if (card.damage) facts.push(`${card.damage} damage`)
    if (card.commander) facts.push('Commander')
    if (card.controllerId !== card.ownerId && players[card.ownerId]) facts.push(`Owned by ${players[card.ownerId].name}`)
  }
  const host = card?.attachedToId != null ? cards[card.attachedToId] : card?.attachedToPlayerId != null ? players[card.attachedToPlayerId] : undefined
  const counters = card ? Object.entries(card.counters).filter(([, n]) => n > 0) : []
  const kws = card ? KEYWORD_ORDER.filter((k) => card.keywords.includes(k)) : []

  return (
    <div className="flex min-h-0 flex-col gap-2 border-l border-line bg-panel/60 p-3">
      <div ref={ref} className="w-full shrink-0">
        {card ? (
          <div className="bf-pop" key={card.id}>
            <CardImage card={card} width={cw} />
          </div>
        ) : (
          <div
            className="grid place-items-center rounded-xl border border-dashed border-line text-center text-xs text-ink-dim"
            style={{ width: cw, height: cw * 1.396 }}
          >
            Hover a card to see it here
          </div>
        )}
      </div>
      {card && !card.hidden && (
        <div className="flex shrink-0 flex-col gap-1.5 text-xs">
          {(facts.length > 0 || kws.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {kws.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 capitalize text-ink">
                  <KeywordIcon k={k} size={11} />
                  {k}
                </span>
              ))}
              {facts.map((f) => (
                <span key={f} className="rounded-full bg-table/60 px-2 py-0.5 text-ink-dim">
                  {f}
                </span>
              ))}
            </div>
          )}
          {counters.length > 0 && (
            <div className="text-ink-dim">
              Counters: {counters.map(([k, n]) => `${n} × ${k.replace('P1P1', '+1/+1').replace('M1M1', '−1/−1').toLowerCase()}`).join(', ')}
            </div>
          )}
          {host && <div className="text-ink-dim">Attached to <span className="text-ink">{host.name}</span></div>}
          {card.attachmentIds.length > 0 && (
            <div className="text-ink-dim">
              Attached: <span className="text-ink">{card.attachmentIds.map((a) => cards[a]?.name).filter(Boolean).join(', ')}</span>
            </div>
          )}
          {card.heldExileIds.length > 0 && (
            <div className="text-ink-dim">
              Exiled with it: <span className="text-ink">{card.heldExileIds.map((a) => cards[a]?.name ?? 'a card').join(', ')}</span>
            </div>
          )}
          {card.backImg && (
            <img src={card.backImg} alt="Other face" loading="lazy" className="mt-1 w-24 rounded-md opacity-90 ring-1 ring-line" />
          )}
        </div>
      )}
      <GameLog />
    </div>
  )
}

function GameLog() {
  const log = useForge((s) => s.game?.log)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])
  if (!log?.length) return <div className="flex-1" />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 mt-1 text-[10px] font-bold uppercase tracking-wider text-ink-dim">Log</div>
      <div ref={ref} className="bf-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 text-[11px] leading-snug text-ink-dim">
        {log.slice(-60).map((l, i) => (
          <div key={i} className={l.type.toLowerCase().includes('combat') || l.type.toLowerCase().includes('damage') ? 'text-ink' : ''}>
            {l.message}
          </div>
        ))}
      </div>
    </div>
  )
}
