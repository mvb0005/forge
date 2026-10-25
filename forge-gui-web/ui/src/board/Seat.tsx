import { useEffect, useMemo, type MouseEvent, type ReactNode } from 'react'
import { send } from '../net'
import type { CardDto, ManaColor, PlayerDto } from '../protocol'
import { useShallow } from 'zustand/react/shallow'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { Icon } from './icons'
import { Sym } from './mana'
import { clickCards, useHighlight } from './Tile'
import { useBoardUi } from './uiStore'

const MANA: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C']

function clickPlayer(e: MouseEvent, id: number) {
  e.preventDefault()
  send({ t: 'selectPlayer', playerId: id, shift: e.shiftKey, button: e.type === 'contextmenu' ? 3 : 1 })
}

function usePlayerFlags(id: number) {
  const chosen = useForge((s) => s.highlighted.has(`player:${id}`))
  const active = useForge((s) => s.game?.activePlayerId === id)
  const priority = useForge((s) => s.game?.priorityPlayerId === id)
  const hs = useBoardUi((s) => s.hoverStackId)
  const emph = useForge((s) => hs != null && !!s.stack.find((i) => i.id === hs)?.targets.some((t) => t.kind === 'player' && t.id === id))
  const attacked = useForge((s) => !!s.combat?.bands.some((b) => b.defender?.kind === 'player' && b.defender.id === id))
  return { chosen, active, priority, emph, attacked }
}

function Avatar({ p, size }: { p: PlayerDto; size: number }) {
  const hue = (p.id * 137) % 360
  return p.avatarImg ? (
    <img src={p.avatarImg} alt="" className="shrink-0 rounded-full object-cover ring-1 ring-line" style={{ width: size, height: size }} />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold text-ink ring-1 ring-white/10"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${hue} 35% 38%), hsl(${(hue + 40) % 360} 30% 22%))` }}
    >
      {p.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function counterLabel(k: string) {
  return k.charAt(0).toUpperCase() + k.slice(1).toLowerCase().replace(/_/g, ' ')
}

/** Full seat panel: name, life, counters, floating mana, zone piles. */
export function SeatPanel({ player: p, isMe, compact }: { player: PlayerDto; isMe: boolean; compact: boolean }) {
  const f = usePlayerFlags(p.id)
  const setZoneView = useBoardUi((s) => s.setZoneView)
  const zoneView = useBoardUi((s) => s.zoneView)
  const ring = f.emph ? 'hl-emph' : f.chosen ? 'hl-chosen' : ''
  const pool = MANA.filter((c) => p.mana[c] > 0)
  const counters = Object.entries(p.counters).filter(([, n]) => n > 0)
  const lifeColor = p.life <= 5 ? 'text-danger' : p.life <= 10 ? 'text-target' : 'text-ink'
  const zoneHl = useForge(
    useShallow((s) =>
      (['graveyard', 'exile', 'command'] as const).map((z) => {
        const ids = p.zones[z]
        if (ids.some((id) => s.selectable.cardIds.has(id))) return 'hl-selectable'
        if (!s.selectable.cardIds.size && ids.some((id) => s.playable.has(id))) return 'hl-playable'
        return ''
      }),
    ),
  )
  const pile = (zone: 'graveyard' | 'exile' | 'command', icon: ReactNode, title: string) => {
    const n = p.zones[zone].length
    const hl = zoneHl[['graveyard', 'exile', 'command'].indexOf(zone)]
    if (zone === 'command' && n === 0) return null
    const open = zoneView?.playerId === p.id && zoneView.zone === zone
    return (
      <button
        type="button"
        title={title}
        disabled={n === 0}
        onClick={(e) => {
          e.stopPropagation()
          setZoneView(open ? null : { playerId: p.id, zone })
        }}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition duration-150 disabled:opacity-40 ${hl} ${
          open ? 'bg-accent/20 text-ink ring-1 ring-accent' : 'bg-table/50 text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        {icon}
        <span className="font-semibold tabular-nums text-ink">{n}</span>
      </button>
    )
  }
  return (
    <div
      data-entity={`player:${p.id}`}
      className={`relative flex h-full flex-col gap-2 rounded-xl border bg-panel/90 p-3 transition duration-150 ${ring} ${
        f.active ? 'border-accent/60' : 'border-line'
      } ${p.hasLost ? 'opacity-50 grayscale' : ''} cursor-pointer`}
      onClick={(e) => clickPlayer(e, p.id)}
      onContextMenu={(e) => clickPlayer(e, p.id)}
    >
      {f.active && <span className="absolute -left-px bottom-3 top-3 w-[3px] rounded-full bg-accent" />}
      <div className="flex items-center gap-2">
        <Avatar p={p} size={compact ? 26 : 32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
            {p.isAI && <span className="rounded bg-panel-2 px-1 text-[9px] font-bold uppercase tracking-wider text-ink-dim">AI</span>}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-dim">
            {f.active && <span className="text-accent">{isMe ? 'Your turn' : 'Their turn'}</span>}
            {f.priority && (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-target" />
                priority
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className={`font-extrabold leading-none tabular-nums tracking-tight ${lifeColor} ${f.attacked ? 'drop-shadow-[0_0_10px_var(--color-danger)]' : ''}`} style={{ fontSize: compact ? 34 : 44 }}>
          {p.life}
        </div>
        <div className="flex flex-col items-end gap-1 pb-0.5 text-[11px] text-ink-dim">
          <span className="inline-flex items-center gap-1" title="Library">
            {Icon.library(13)}
            <span className="font-semibold tabular-nums text-ink">{p.libraryCount}</span>
          </span>
          {!isMe && (
            <span className="inline-flex items-center gap-1" title="Cards in hand">
              {Icon.hand(13)}
              <span className="font-semibold tabular-nums text-ink">{p.handCount}</span>
            </span>
          )}
        </div>
      </div>

      {(p.poison > 0 || counters.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {p.poison > 0 && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${p.poison >= 7 ? 'bg-danger/25 text-danger' : 'bg-playable/15 text-playable'}`} title="Poison counters">
              {Icon.poison(11)}
              {p.poison}
            </span>
          )}
          {counters.map(([k, n]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-xs text-ink" title={`${counterLabel(k)} counters`}>
              {k.toLowerCase() === 'energy' ? Icon.bolt(11) : null}
              {counterLabel(k).slice(0, 10)} <b>{n}</b>
            </span>
          ))}
        </div>
      )}

      {pool.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-table/60 px-1.5 py-1" title="Floating mana">
          {pool.map((c) => (
            <button
              key={c}
              type="button"
              disabled={!isMe}
              onClick={(e) => {
                e.stopPropagation()
                send({ t: 'useMana', color: c })
              }}
              className="inline-flex items-center gap-0.5 rounded-full pr-1.5 text-xs font-bold text-ink enabled:hover:bg-panel-2"
            >
              <Sym s={c} size={17} />
              {p.mana[c]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-1">
        {pile('graveyard', Icon.graveyard(13), 'Graveyard')}
        {pile('exile', Icon.exile(13), 'Exile')}
        {pile('command', Icon.command(13), 'Command zone')}
      </div>
      {zoneView?.playerId === p.id && <ZoneViewer player={p} zone={zoneView.zone} up={isMe} />}
    </div>
  )
}

const ZONE_TITLE = { graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone', hand: 'Hand' }

function ZoneViewer({ player, zone, up }: { player: PlayerDto; zone: 'graveyard' | 'exile' | 'command' | 'hand'; up: boolean }) {
  const cards = useForge((s) => s.cards)
  const setZoneView = useBoardUi((s) => s.setZoneView)
  const list = useMemo(() => [...player.zones[zone]].reverse().map((id) => cards[id]).filter((c): c is CardDto => !!c), [player, zone, cards])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoneView(null)
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('[data-zone-viewer]')) setZoneView(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [setZoneView])
  const cw = 112
  const cols = Math.min(5, Math.max(2, list.length))
  return (
    <div
      data-zone-viewer
      className={`bf-pop absolute left-full ${up ? 'bottom-0' : 'top-0'} z-50 ml-2 flex max-h-[min(76vh,640px)] flex-col rounded-xl border border-line bg-panel shadow-2xl`}
      style={{ width: cols * (cw + 8) + 24 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="text-sm font-semibold text-ink">
          {ZONE_TITLE[zone]} <span className="text-ink-dim">· {player.name} · {list.length}</span>
        </div>
        <button type="button" className="rounded px-1.5 text-ink-dim hover:bg-panel-2 hover:text-ink" onClick={() => setZoneView(null)}>
          ✕
        </button>
      </div>
      <div className="bf-scroll grid gap-2 overflow-y-auto p-3" style={{ gridTemplateColumns: `repeat(${cols}, ${cw}px)` }}>
        {list.map((c) => (
          <ZoneCard key={c.id} card={c} w={cw} />
        ))}
      </div>
    </div>
  )
}

function ZoneCard({ card, w }: { card: CardDto; w: number }) {
  const { ring, dim } = useHighlight([card.id])
  return (
    <div
      data-entity={`card:${card.id}`}
      className={`bf-card cursor-pointer rounded-[6px] ${ring} ${dim ? 'opacity-60' : ''} hover:-translate-y-0.5`}
      onMouseEnter={() => useForge.getState().setHovered(card.id)}
      onMouseLeave={() => useForge.getState().setHovered(null)}
      onClick={(e) => clickCards(e, [card.id])}
      onContextMenu={(e) => clickCards(e, [card.id])}
    >
      <CardImage card={card} width={w} />
    </div>
  )
}

/** Multiplayer: an unfocused opponent as a compact strip. Click to focus. */
export function OpponentStrip({ player: p, cards, onFocus }: { player: PlayerDto; cards: Record<number, CardDto>; onFocus: () => void }) {
  const f = usePlayerFlags(p.id)
  const stats = useMemo(() => {
    let creatures = 0
    let power = 0
    let untapped = 0
    for (const id of p.zones.battlefield) {
      const c = cards[id]
      if (!c || !c.types.includes('Creature')) continue
      creatures++
      power += c.power ?? 0
      if (!c.tapped) untapped++
    }
    return { creatures, power, untapped }
  }, [p, cards])
  const attackingMe = useForge((s) => {
    const me = s.game?.localPlayerIds[0]
    return !!s.combat?.bands.some((b) => b.defender?.kind === 'player' && b.defender.id === me && s.cards[b.attackerIds[0]]?.controllerId === p.id)
  })
  const ring = f.emph ? 'hl-emph' : f.chosen ? 'hl-chosen' : ''
  return (
    <button
      type="button"
      data-entity={`player:${p.id}`}
      onClick={(e) => {
        if (e.shiftKey || useForge.getState().selectable.cardIds.size) clickPlayer(e, p.id)
        else onFocus()
      }}
      onContextMenu={(e) => clickPlayer(e, p.id)}
      title="Click to focus this opponent"
      className={`group relative flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border bg-panel/90 px-3 py-1.5 text-left transition duration-150 hover:bg-panel-2 ${ring} ${
        attackingMe ? 'border-danger/70' : f.active ? 'border-accent/60' : 'border-line'
      } ${p.hasLost ? 'opacity-50 grayscale' : ''}`}
    >
      <Avatar p={p} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
          {f.active && <span className="text-[9px] font-bold uppercase tracking-wider text-accent">turn</span>}
          {attackingMe && <span className="text-[9px] font-bold uppercase tracking-wider text-danger">attacking you</span>}
        </div>
        <div className="flex gap-2.5 text-[11px] text-ink-dim">
          <span title="Creatures">
            <b className="text-ink">{stats.creatures}</b> creatures
          </span>
          <span title="Total power" className="inline-flex items-center gap-0.5">
            {Icon.sword(11)}
            <b className="text-ink">{stats.power}</b>
          </span>
          <span title="Untapped creatures">
            <b className="text-ink">{stats.untapped}</b> untapped
          </span>
          <span title="Cards in hand" className="inline-flex items-center gap-0.5">
            {Icon.hand(11)}
            <b className="text-ink">{p.handCount}</b>
          </span>
        </div>
      </div>
      {p.poison > 0 && (
        <span className="inline-flex items-center gap-0.5 text-xs font-bold text-playable">
          {Icon.poison(11)}
          {p.poison}
        </span>
      )}
      <span className={`text-2xl font-extrabold tabular-nums ${p.life <= 5 ? 'text-danger' : 'text-ink'}`}>{p.life}</span>
    </button>
  )
}
