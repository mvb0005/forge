import { useEffect, useRef, useState } from 'react'
import type { Region } from '../table/contract'
import { usePeek } from '../popover/usePeek'
import { send } from '../net'
import { entityKey, useForge, type Reveal } from '../store'
import type { CardDto } from '../protocol'
import { CardImage } from './CardImage'

// Revealed cards, fanned over the revealing player's part of the table for a few seconds (hover keeps them), then
// gone: the Timeline keeps every reveal, and clicking one there opens it here again until you close it.

const SHOW_MS = 4500
const PER_CARD_MS = 900
const MAX_MS = 9000
const LOOKING = /looking at|reveal/i

/** Who revealed, in words: "AI 1 reveals", "You reveal". Forge's own title, when it has one, says more. */
export function revealHeadline(r: Reveal, players: Record<number, { name: string }>, localIds: number[], cards: Record<number, CardDto> = {}) {
  const t = r.title.trim().replace(/:$/, '')
  if (t) return t
  // Face-down cards shown to you (Ixhel's exile) aren't revealed to anyone: you're looking at them.
  // As the cards are now: the look comes as they go into exile, before they turn face down.
  if (r.cards.length && r.cards.every((c) => (cards[c.id] ?? c).faceDown)) return `You look at ${r.cards.length === 1 ? 'a face-down card' : `${r.cards.length} face-down cards`}`
  if (r.ownerId == null) return 'Revealed'
  return localIds.includes(r.ownerId) ? 'You reveal' : `${players[r.ownerId]?.name ?? 'Someone'} reveals`
}

function Shown({ card, width, picking }: { card: CardDto; width: number; picking: boolean }) {
  const peek = usePeek({ kind: 'card', id: card.id })
  // The engine asking you to pick from these (Duress: the card to discard): click to choose, as on the table.
  const choice = useForge((s) => s.selectable.cardIds.has(card.id))
  const chosen = useForge((s) => s.highlighted.has(entityKey({ kind: 'card', id: card.id })))
  const ring = chosen ? '0 0 0 3px var(--lk-gold)' : choice ? '0 0 0 2px rgb(143 180 227 / .9)' : '0 0 0 1px var(--lk-metal-line)'
  // As revealed: a card back in a hidden hand still shows its face here.
  return (
    <div
      {...peek}
      data-reveal-card={card.id}
      onClick={choice ? () => send({ t: 'selectCard', cardId: card.id, shift: false, button: 1 }) : undefined}
      title={choice ? 'Choose this card' : undefined}
      style={{ width, borderRadius: width * 0.05, overflow: 'hidden', cursor: choice ? 'pointer' : 'help', transform: chosen ? 'translateY(-4px)' : undefined, transition: 'transform .15s', opacity: picking && !choice && !chosen ? 0.45 : 1, boxShadow: `0 10px 28px rgb(0 0 0 / .55), ${ring}` }}
    >
      <CardImage card={{ ...card, hidden: false }} width={width} bare />
    </div>
  )
}

// Cards the engine asks you to pick that have no place on the table: another player's hand, a library.
const offTable = (c: CardDto, localIds: number[]) => c.zone === 'library' || (c.zone === 'hand' && !localIds.includes(c.ownerId))

/** The engine asking you to pick from cards nobody can see on the table (Duress: the card to discard). */
function usePicks(): Reveal | null {
  const ids = useForge((s) => s.selectable.cardIds)
  const cards = useForge((s) => s.cards)
  const localIds = useForge((s) => s.game?.localPlayerIds ?? [])
  const players = useForge((s) => s.players)
  const picks = [...ids].map((id) => cards[id]).filter((c): c is CardDto => !!c && offTable(c, localIds))
  if (!picks.length) return null
  const ownerId = picks[0].ownerId
  const zone = picks[0].zone
  // A hand is shown whole (what you can't pick dimmed), a library only its candidates: it can be 99 cards.
  const shown = zone === 'hand' ? Object.values(cards).filter((c) => c.ownerId === ownerId && c.zone === 'hand' && !c.hidden) : picks
  const whose = localIds.includes(ownerId) ? 'your' : `${players[ownerId]?.name ?? 'their'}’s`
  return { key: -1, title: `Choose from ${whose} ${zone}`, cardIds: shown.map((c) => c.id), cards: shown, ownerId, after: null }
}

export function RevealFlyout({ area }: { area: (ownerId: number | null) => Region }) {
  const picks = usePicks()
  const latest = useForge((s) => s.reveal)
  const openKey = useForge((s) => s.revealOpen)
  const reopened = useForge((s) => (s.revealOpen == null ? null : s.reveals.find((r) => r.key === s.revealOpen) ?? null))
  const players = useForge((s) => s.players)
  const localIds = useForge((s) => s.game?.localPlayerIds ?? [])
  const openReveal = useForge((s) => s.openReveal)
  const liveCards = useForge((s) => s.cards)
  // The engine waiting on you about these cards ("Looking at cards in AI 1's hand", OK): they stay until you answer.
  // ... or to pick from them: they stay while any of them is selectable.
  const looking = useForge((s) => LOOKING.test(s.prompt?.message ?? '') || LOOKING.test((s.ask && 'title' in s.ask ? s.ask.title : '') ?? '')
    || !!s.reveal?.cardIds.some((id) => s.selectable.cardIds.has(id)))
  // A choice open on exactly these cards (Impulse: pick one of the top four) already shows them: once is enough.
  const covered = useForge((s) => {
    const items = s.ask && 'items' in s.ask ? s.ask.items : null
    return !!items && !!s.reveal?.cardIds.length && s.reveal.cardIds.every((id) => items.some((i) => i.ref?.kind === 'card' && i.ref.id === id))
  })
  const [gone, setGone] = useState<number | null>(null) // the latest reveal's key once its time is up
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wasLooking = useRef(false)
  const r = picks ?? reopened ?? (latest && latest.key !== gone ? latest : null)
  const pinned = reopened != null
  const held = pinned || looking

  const arm = (ms: number) => {
    clearTimeout(timer.current)
    if (!latest || held) return
    const key = latest.key
    timer.current = setTimeout(() => setGone(key), ms)
  }
  useEffect(() => {
    if (latest) arm(looking === false && wasLooking.current ? 2500 : Math.min(MAX_MS, SHOW_MS + PER_CARD_MS * (latest.cards.length - 1)))
    wasLooking.current = looking
    return () => clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.key, held])

  if (!r || !r.cards.length || (covered && !pinned && !picks)) return null
  const box = area(r.ownerId)
  const n = r.cards.length
  const width = Math.max(70, Math.min(150, (box.w * 0.82) / n - 10, (box.h * 0.62) / 1.4))
  const headline = revealHeadline(r, players, localIds, liveCards)
  return (
    <div
      data-reveal={r.key}
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={() => arm(1500)}
      className="shell-in"
      style={{
        position: 'absolute', left: box.x + box.w / 2, top: box.y + box.h / 2, transform: 'translate(-50%, -50%)', zIndex: 40,
        maxWidth: box.w * 0.94, padding: '10px 12px 12px', borderRadius: 12,
        background: 'linear-gradient(rgb(143 180 227 / .10), rgb(143 180 227 / .03)), rgb(14 11 8 / .92)',
        boxShadow: '0 0 0 1px rgb(143 180 227 / .45), 0 18px 50px rgb(0 0 0 / .6)', backdropFilter: 'blur(2px)',
      }}
    >
      <div className="lk-label" style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--lk-frost)' }}>
        <span>{picks ? 'Choose' : 'Revealed'}</span>
        <span className="lk-title" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--lk-parchment)' }}>{headline}</span>
        {pinned && (
          <button type="button" onClick={() => openReveal(null)} title="Close" style={{ marginLeft: 'auto', border: 0, background: 'none', cursor: 'pointer', color: 'var(--lk-parchment-dim)', fontSize: 16, lineHeight: 1 }}>×</button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', justifyContent: 'center' }}>
        {r.cards.map((c) => <Shown key={c.id} card={c} width={width} picking={!!picks} />)}
      </div>
      {openKey == null && !picks && n > 0 && <div aria-hidden style={{ marginTop: 6, fontSize: 11, color: 'var(--lk-parchment-mute)', textAlign: 'center' }}>Kept in the Timeline</div>}
    </div>
  )
}
