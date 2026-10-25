import { useState, type MouseEvent } from 'react'
import type { CardDto, CombatBand, EntityRef } from '../protocol'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { Icon } from './icons'
import { CARD_RATIO } from './layout'
import { clickCards, useHighlight } from './Tile'

// Popup that lays combat out as pairings: attackers, what blocks them, and what they're attacking.
// Who dies and how much gets through come from the server (assist channel, the engine's own
// combat evaluator); this component never does rules math.
export function CombatArena({ meId }: { meId: number | null }) {
  const combat = useForge((s) => s.combat)
  const cards = useForge((s) => s.cards)
  const players = useForge((s) => s.players)
  const game = useForge((s) => s.game)
  const assist = useForge((s) => s.combatAssist)
  const [collapsedTurn, setCollapsedTurn] = useState<number | null>(null)
  if (!combat || combat.bands.length === 0 || !game) return null

  const beforeBlocks = game.phase === 'COMBAT_BEGIN' || game.phase === 'COMBAT_DECLARE_ATTACKERS'
  const attackingMe = combat.bands.some((b) => b.defender?.kind === 'player' && b.defender.id === meId)
  const dies = new Set([...(assist?.attackers ?? []), ...(assist?.blockers ?? [])].filter((x) => x.dies).map((x) => x.id))
  const damage = new Map((assist?.attackers ?? []).map((a) => [a.id, a.damage]))
  const summary = (assist?.players ?? []).map((a) => {
    const p = players[a.id]
    return { pid: a.id, name: a.id === meId ? 'You' : p?.name ?? '?', life: p?.life ?? 0, after: a.lifeAfter, poison: a.poisonAfter, lethal: a.lethal }
  })

  const collapsed = collapsedTurn === game.turn
  const tone = attackingMe ? 'border-danger/60' : 'border-accent/50'

  if (collapsed) {
    return (
      <button type="button" onClick={() => setCollapsedTurn(null)}
        style={{ right: RIGHT }}
        className={`absolute top-3 z-30 flex items-center gap-2 rounded-full border ${tone} bg-panel/95 px-3 py-1.5 text-xs font-semibold text-ink shadow-lg shadow-black/40 backdrop-blur hover:bg-panel-2`}>
        {Icon.sword(13)}
        Combat · {combat.bands.reduce((n, b) => n + b.attackerIds.length, 0)} attacking
        {summary.some((s) => s.lethal) && <span className="rounded bg-danger px-1.5 text-[10px] text-table">LETHAL</span>}
      </button>
    )
  }

  return (
    <div style={{ right: RIGHT }} className={`absolute top-3 z-30 flex max-h-[calc(100%-24px)] max-w-[min(760px,calc(100%-24px))] flex-col gap-2 rounded-2xl border ${tone} bg-panel/95 p-3 shadow-2xl shadow-black/50 backdrop-blur`}>
      <div className="flex items-center gap-3">
        <span className={`text-xs font-bold uppercase tracking-wider ${attackingMe ? 'text-danger' : 'text-accent'}`}>
          {attackingMe ? 'Incoming attack' : 'Combat'}
        </span>
        <span className="text-[11px] text-ink-dim">{beforeBlocks ? 'if unblocked' : 'expected, from the board as it stands'}</span>
        <span className="flex-1" />
        {summary.map((s) => (
          <span key={s.pid} className="flex items-center gap-1.5 text-xs text-ink">
            {s.name}
            <span className="text-ink-dim tabular-nums">{s.life} → <b className="text-ink">{s.after}</b></span>
            {s.poison > 0 && <span className="text-ink-dim tabular-nums">· {s.poison} poison</span>}
            {s.lethal && <span className="rounded bg-danger px-1.5 text-[10px] font-bold text-table">LETHAL</span>}
          </span>
        ))}
        <button type="button" title="Collapse" onClick={() => setCollapsedTurn(game.turn)}
          className="rounded-md px-1.5 text-ink-dim hover:bg-panel-2 hover:text-ink">–</button>
      </div>
      <div className="flex min-h-0 gap-2 overflow-x-auto pb-1">
        {combat.bands.map((b) => (
          <Pairing key={b.attackerIds.join(',')} band={b} cards={cards} meId={meId} dies={dies}
            toDefender={b.attackerIds.reduce((n, id) => n + (damage.get(id) ?? 0), 0)} beforeBlocks={beforeBlocks} defenderName={defenderName(b.defender, cards, players, meId)} />
        ))}
      </div>
    </div>
  )
}

function defenderName(d: EntityRef | null, cards: Record<number, CardDto>, players: Record<number, { name: string }>, meId: number | null) {
  if (!d) return '?'
  if (d.kind === 'player') return d.id === meId ? 'You' : players[d.id]?.name ?? '?'
  return cards[d.id]?.name ?? '?'
}

function Pairing(p: {
  band: CombatBand; cards: Record<number, CardDto>; meId: number | null; dies: Set<number>
  toDefender: number; beforeBlocks: boolean; defenderName: string
}) {
  const attackers = p.band.attackerIds.map((id) => p.cards[id]).filter((c): c is CardDto => !!c)
  const blockers = [...new Set([...p.band.blockerIds, ...p.band.plannedBlockerIds])].map((id) => p.cards[id]).filter((c): c is CardDto => !!c)
  const atMe = p.band.defender?.kind === 'player' && p.band.defender.id === p.meId
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5 rounded-xl border border-line/70 bg-table/60 p-2">
      <div className="flex gap-1.5">
        {attackers.map((c) => <ArenaCard key={c.id} card={c} dies={p.dies.has(c.id)} />)}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
        {blockers.length > 0 ? <>blocked by</> : p.beforeBlocks ? <>attacking</> : <span className={atMe ? 'text-danger' : 'text-playable'}>unblocked</span>}
      </div>
      {blockers.length > 0 && (
        <div className="flex gap-1.5">
          {blockers.map((c) => <ArenaCard key={c.id} card={c} dies={p.dies.has(c.id)} />)}
        </div>
      )}
      <div className={`mt-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${atMe ? 'bg-danger/15 text-danger' : 'bg-panel-2 text-ink'}`}>
        → {p.defenderName}
        {p.toDefender > 0 && <b className="tabular-nums">· {p.toDefender}</b>}
      </div>
    </div>
  )
}

const W = 78
// clear of the preview column (MatchTable's second grid column)
const RIGHT = 'calc(clamp(230px, 17vw, 330px) + 12px)'

function ArenaCard({ card, dies }: { card: CardDto; dies: boolean }) {
  const { ring, dim } = useHighlight([card.id])
  const hurt = card.damage > 0
  return (
    <div
      data-arena-card={card.id}
      className={`relative cursor-pointer rounded-[6px] transition duration-150 ${ring} ${dim ? 'opacity-50' : ''}`}
      style={{ width: W, height: W * CARD_RATIO }}
      onMouseEnter={() => useForge.getState().setHovered(card.id)}
      onMouseLeave={() => useForge.getState().setHovered(null)}
      onClick={(e: MouseEvent) => clickCards(e, [card.id])}
      onContextMenu={(e: MouseEvent) => clickCards(e, [card.id])}
    >
      <div className={`h-full w-full overflow-hidden rounded-[6px] ${dies ? 'grayscale-[60%]' : ''}`}>
        <CardImage card={card} width={W} bare />
      </div>
      {card.power != null && (
        <span className={`absolute bottom-1 right-1 rounded-md px-1 text-[11px] font-bold tabular-nums shadow ${hurt ? 'bg-danger text-table' : 'bg-table/90 text-ink'}`}>
          {card.power}/{(card.toughness ?? 0) - card.damage}
        </span>
      )}
      {dies && (
        <span className="absolute inset-x-0 top-1/3 mx-auto w-fit rounded-md bg-danger/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-table shadow">
          dies
        </span>
      )}
    </div>
  )
}
