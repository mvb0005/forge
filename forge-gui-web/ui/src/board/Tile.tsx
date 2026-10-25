import { useState, type MouseEvent } from 'react'
import { send } from '../net'
import type { CardDto } from '../protocol'
import { useShallow } from 'zustand/react/shallow'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { Icon, KEYWORD_ORDER, KeywordIcon } from './icons'
import { CARD_RATIO, pickFromGroup } from './layout'
import { useBoardUi } from './uiStore'

/** Highlight class for a set of card ids, in the one highlight language. */
export function useHighlight(ids: number[]) {
  const selecting = useForge((s) => s.selectable.cardIds.size > 0)
  const selectable = useForge((s) => ids.some((id) => s.selectable.cardIds.has(id)))
  const chosen = useForge((s) => ids.some((id) => s.highlighted.has(`card:${id}`)))
  const playable = useForge((s) => ids.some((id) => s.playable.has(id)))
  const hs = useBoardUi((s) => s.hoverStackId)
  const emph = useForge((s) => {
    if (hs == null) return false
    const item = s.stack.find((i) => i.id === hs)
    return !!item && ids.some((id) => item.sourceCardId === id || item.targets.some((t) => t.kind === 'card' && t.id === id))
  })
  const ring = emph ? 'hl-emph' : chosen ? 'hl-chosen' : selectable ? 'hl-selectable' : playable && !selecting ? 'hl-playable' : ''
  return { ring, dim: selecting && !selectable && !chosen && !emph }
}

export function clickCards(e: MouseEvent, ids: number[]) {
  e.preventDefault()
  e.stopPropagation()
  const s = useForge.getState()
  const { cardId, others } = pickFromGroup(ids, s.cards, s.selectable.cardIds, s.playable, s.highlighted)
  const button = e.type === 'contextmenu' || e.button === 2 ? 3 : 1
  send({ t: 'selectCard', cardId, others: e.shiftKey && others.length ? others : undefined, shift: e.shiftKey, button })
}

export const TAP_SCALE = 0.76

export type TileFaceProps = {
  card: CardDto
  w: number
  count: number
  tapped: boolean
  ring: string
  role: 'attacker' | 'blocker' | null
  edge: 'top' | 'bottom' // which edge faces the center
  label?: string // land pile: "2 tapped"
  more?: number // attachments not drawn
}

/** What a battlefield element looks like: the card (tapped = quarter turn), copies fanned behind it, overlays. */
export function TileFace({ card: top, w, count, tapped, ring, role, edge, label, more }: TileFaceProps) {
  const th = w * CARD_RATIO
  const fan = Math.min(count, 3)
  const fd = Math.max(2, w * 0.045)
  const box = tapped ? { w: th * TAP_SCALE, h: w * TAP_SCALE } : { w, h: th }
  const bx = (w - box.w) / 2
  const by = (th - box.h) / 2
  const fs = Math.max(9, Math.min(14, w * 0.115))
  const turn = tapped ? `rotate(90deg) scale(${TAP_SCALE})` : 'none'
  return (
    <>
      {Array.from({ length: fan - 1 }, (_, i) => {
        const k = fan - 1 - i
        return (
          <div
            key={k}
            className="bf-card pointer-events-none absolute left-0 top-0"
            style={{ transform: `translate(${k * fd}px, ${-k * fd}px) ${tapped ? turn : ''}`, filter: `brightness(${1 - k * 0.12})` }}
          >
            <CardImage card={top} width={w} bare mini={tapped} />
          </div>
        )
      })}
      <div
        className={`bf-card absolute left-0 top-0 ${ring}`}
        style={{
          transform: turn,
          borderRadius: Math.max(3, w * 0.048),
          filter: top.sick ? 'brightness(0.72) saturate(0.75)' : undefined,
          outline: top.phasedOut ? '1.5px dashed var(--color-ink-dim)' : undefined,
        }}
      >
        <CardImage card={top} width={w} bare mini={tapped} />
      </div>
      <div className="pointer-events-none absolute" style={{ left: bx, top: by, width: box.w, height: box.h }}>
        <Overlays card={top} w={w} fs={fs} count={count} label={label} mini={tapped || w < 110} />
        {role && (
          <div
            className="absolute inset-x-[6%] rounded-full"
            style={{
              height: 3,
              [edge]: -5,
              background: role === 'attacker' ? 'var(--color-danger)' : 'var(--color-ink)',
              boxShadow: `0 0 8px 1px ${role === 'attacker' ? 'var(--color-danger)' : 'var(--color-ink-dim)'}`,
            }}
          />
        )}
        {top.heldExileIds.length > 0 && <HeldExile ids={top.heldExileIds} fs={fs} />}
        {!!more && <span className="absolute right-1 top-0.5 rounded-full bg-panel-2 px-1.5 text-[10px] font-bold text-ink ring-1 ring-line">+{more}</span>}
      </div>
    </>
  )
}

function counterChip(k: string, n: number): { label: string; cls: string; title: string } | null {
  const key = k.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (key === 'LOYALTY' || key === 'DEFENSE') return null
  if (key === 'P1P1') return { label: `+${n}`, cls: 'bg-playable/90 text-table', title: `${n} +1/+1 counter${n > 1 ? 's' : ''}` }
  if (key === 'M1M1') return { label: `−${n}`, cls: 'bg-danger/90 text-table', title: `${n} −1/−1 counter${n > 1 ? 's' : ''}` }
  const pretty = k.charAt(0).toUpperCase() + k.slice(1).toLowerCase().replace(/_/g, ' ')
  return { label: `${pretty.slice(0, 4)} ${n}`, cls: 'bg-panel-2/95 text-ink ring-1 ring-line', title: `${n} ${pretty} counter${n > 1 ? 's' : ''}` }
}

function Overlays({ card, w, fs, count, label, mini }: { card: CardDto; w: number; fs: number; count: number; label?: string; mini: boolean }) {
  const chips = Object.entries(card.counters)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => counterChip(k, n))
    .filter((c) => c !== null)
  const kws = KEYWORD_ORDER.filter((k) => card.keywords.includes(k))
  const ks = Math.max(10, Math.min(15, w * 0.12))
  const maxKw = Math.max(1, Math.floor((w * 0.58) / (ks + 3)))
  const isPw = card.types.includes('Planeswalker')
  const isBattle = card.types.includes('Battle') && !card.types.includes('Creature')
  const pt = card.power != null && card.toughness != null && !isPw && !isBattle
  const hurt = card.damage > 0
  return (
    <>
      {chips.length > 0 && (
        <div className={`absolute left-[3%] ${mini ? 'top-[30%]' : 'top-[14%]'} flex flex-col items-start gap-0.5`}>
          {chips.slice(0, 3).map((c) => (
            <span key={c.title} title={c.title} className={`rounded-md px-1 font-bold leading-[1.35] shadow ${c.cls}`} style={{ fontSize: fs * 0.88 }}>
              {c.label}
            </span>
          ))}
        </div>
      )}
      {count > 1 && (
        <span
          className="absolute -right-1.5 -top-1.5 rounded-full bg-ink px-1.5 font-extrabold leading-[1.45] text-table shadow-md ring-2 ring-table"
          style={{ fontSize: fs }}
        >
          ×{count}
        </span>
      )}
      {card.sick && (
        <span className="absolute right-[4%] top-[34%] grid place-items-center rounded-full bg-table/85 p-0.5 text-ink-dim" title="Summoning sick">
          {Icon.clock(fs * 1.05)}
        </span>
      )}
      {kws.length > 0 && (
        <div className="absolute bottom-[3%] left-[3%] flex flex-wrap gap-[2px]" style={{ maxWidth: w * 0.62 }}>
          {kws.slice(0, maxKw).map((k) => (
            <span key={k} className="grid place-items-center rounded-full bg-table/85 text-ink ring-1 ring-white/10" style={{ width: ks + 3, height: ks + 3 }}>
              <KeywordIcon k={k} size={ks - 1} />
            </span>
          ))}
        </div>
      )}
      {label && (
        <span
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-panel/95 px-1.5 font-semibold leading-[1.5] text-ink shadow ring-1 ring-line"
          style={{ fontSize: fs * 0.85 }}
        >
          {label}
        </span>
      )}
      {pt && (
        <span
          className={`absolute bottom-[3%] right-[3%] rounded-md px-1 font-extrabold leading-[1.3] shadow ${hurt ? 'bg-danger text-white' : 'bg-ink text-table'}`}
          style={{ fontSize: fs * 1.05 }}
          title={hurt ? `${card.power}/${card.toughness} with ${card.damage} damage` : undefined}
        >
          {card.power}/{card.toughness! - card.damage}
        </span>
      )}
      {(isPw || isBattle) && (
        <span
          className={`absolute bottom-[3%] right-[3%] inline-flex items-center gap-0.5 rounded-md px-1 font-extrabold leading-[1.3] shadow ${isPw ? 'bg-ink text-table' : 'bg-target text-table'}`}
          style={{ fontSize: fs * 1.05 }}
        >
          {Icon.shield(fs * 0.85)}
          {isPw ? card.loyalty : card.defense}
        </span>
      )}
    </>
  )
}

function HeldExile({ ids, fs }: { ids: number[]; fs: number }) {
  const names = useForge(useShallow((s) => ids.map((id) => s.cards[id]?.name ?? 'Unknown card')))
  const [open, setOpen] = useState(false)
  return (
    <span
      className="pointer-events-auto absolute right-[4%] top-[52%] inline-flex items-center gap-0.5 rounded-full bg-table/90 px-1 font-bold text-ink ring-1 ring-line"
      style={{ fontSize: fs * 0.85 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {Icon.exile(fs * 0.9)}
      {ids.length}
      {open && (
        <div className="bf-pop absolute left-full top-0 z-50 ml-1 w-max max-w-56 rounded-lg border border-line bg-panel p-2 text-xs font-normal shadow-xl">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-dim">Exiled with this</div>
          {names.map((n, i) => (
            <div key={ids[i]} className="truncate">
              {n}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
