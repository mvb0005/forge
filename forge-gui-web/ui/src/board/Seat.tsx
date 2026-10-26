import { useEffect, useMemo, type CSSProperties, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { RING } from '../look/CardFrame'
import { LifeShield, type CommanderHit, type ShieldRim } from '../look/LifeShield'
import { foldLands, ManaRibbon, type RibbonSource } from '../look/ManaRibbon'
import { ManaSymbol } from '../look/ManaSymbol'
import { SeatStrip, type SeatStatus } from '../look/SeatStrip'
import { boardIdentity, identity } from '../look/tones'
import { send } from '../net'
import { usePeek } from '../popover/usePeek'
import type { CardDto, ManaColor, PlayerDto } from '../protocol'
import { useForge, type ForgeState } from '../store'
import { CardImage } from './CardImage'
import { pickFromGroup } from './layout'
import { clickCards, useCardLook } from './Tile'
import { useBoardUi } from './uiStore'

// Seat chrome in the look: the life shield and name (clickable as a player), floating mana, the mana
// ribbon, your piles, and multiplayer seat strips. Everything here only displays the store.

const MANA: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C']

function clickPlayer(e: MouseEvent, id: number) {
  e.preventDefault()
  e.stopPropagation()
  send({ t: 'selectPlayer', playerId: id, shift: e.shiftKey, button: e.type === 'contextmenu' ? 3 : 1 })
}

type PlayerMark = 'choose' | 'chosen' | 'targeted' | null

function usePlayerMark(id: number): PlayerMark {
  const hs = useBoardUi((s) => s.hoverStackId)
  return useForge((s) => {
    const item = hs != null ? s.stack.find((i) => i.id === hs) : s.stack[0]
    if (item?.targets.some((t) => t.kind === 'player' && t.id === id)) return 'targeted'
    if (s.highlighted.has(`player:${id}`)) return 'chosen'
    if (s.selectable.playerIds?.has(id)) return 'choose'
    return null
  })
}

const MARK_SHADOW: Record<Exclude<PlayerMark, null>, string> = {
  choose: 'drop-shadow(0 0 6px var(--lk-gold)) drop-shadow(0 0 14px var(--lk-gold-soft))',
  chosen: 'drop-shadow(0 0 3px var(--lk-brass)) drop-shadow(0 0 12px var(--lk-brass-soft))',
  targeted: 'drop-shadow(0 0 5px var(--lk-ember)) drop-shadow(0 0 16px var(--lk-ember-soft))',
}

const isRock = (c: CardDto) => !c.types.includes('Land') && c.types.includes('Artifact') && /\{T\}[^.:]*: Add \{/.test(c.text)

function rockSym(c: CardDto) {
  const m = c.text.match(/\{T\}[^.:]*: Add \{([^}]+)\}/)
  const s = (m?.[1] ?? 'C').toUpperCase()
  const count = c.text.match(/: Add ((?:\{C\})+)/)?.[1].length
  return count && count > 3 ? String(count / 3) : s
}

/** Lands folded by the mana they make, then mana rocks (presentation, from type line and text). */
export function ribbonSources(cards: CardDto[]): RibbonSource[] {
  const rocks = cards.filter(isRock).map((c) => ({ sym: rockSym(c), untapped: c.tapped ? 0 : 1, total: 1, label: c.name, ids: [c.id] }))
  return [...foldLands(cards), ...rocks]
}

/** The cards a ribbon is made of: lands and mana rocks only, so a creature's P/T change doesn't touch it. */
export function useRibbonCards(p: PlayerDto | undefined) {
  return useForge(useShallow((s: ForgeState) => (p ? p.zones.battlefield.map((id) => s.cards[id]).filter((c) => c && (c.types.includes('Land') || isRock(c))) : [])))
}

/**
 * Untapped mana a player could make now: the engine's count (mana assist, which includes dorks) while it is
 * fresh, i.e. while you hold priority; otherwise the ribbon's own count, so the two never disagree on screen.
 */
export function useOpenMana(p: PlayerDto | undefined, sources: RibbonSource[]) {
  const sent = useForge((s) => (p && s.game?.priorityPlayerId != null && s.game.localPlayerIds.includes(s.game.priorityPlayerId) ? s.manaAssist?.players.find((x) => x.id === p.id)?.total : undefined))
  return sent ?? sources.reduce((n, s) => n + s.untapped, 0)
}

/** Colour identity for a player's half: from the server when it sends one, else from the board. */
export function useSeatColors(p: PlayerDto | undefined) {
  const sent = p?.colorIdentity
  const board = useForge(useShallow((s) => (p && sent == null ? boardIdentity(p.zones.battlefield.map((id) => s.cards[id]).filter(Boolean)) : [])))
  return sent != null ? identity(sent).join('') : board.join('')
}

function pickSource(src: RibbonSource) {
  const s = useForge.getState()
  const ids = src.ids ?? []
  const open = ids.filter((id) => !s.cards[id]?.tapped)
  const { cardId } = pickFromGroup(open.length ? open : ids, s.cards, s.selectable.cardIds, s.playable, s.highlighted)
  if (cardId != null) send({ t: 'selectCard', cardId, shift: false, button: 1 })
}

export function Ribbon({ player, isMe, style }: { player: PlayerDto; isMe: boolean; style?: CSSProperties }) {
  const cards = useRibbonCards(player)
  const sources = useMemo(() => ribbonSources(cards), [cards])
  const usable = useForge((s) => isMe && s.game?.priorityPlayerId === player.id)
  const n = useOpenMana(player, sources)
  return (
    <div style={style}>
      <ManaRibbon sources={sources} usable={usable} size={isMe ? 26 : 24} summary={isMe ? undefined : `${n} untapped`} onPick={isMe ? pickSource : undefined} />
    </div>
  )
}

/** Life shield and name. The shield is the player for clicks, targets and arrows. `compact` is the column header on your turn. */
export function SeatPlate({ player: p, isMe, compact = false }: { player: PlayerDto; isMe: boolean; compact?: boolean }) {
  const mark = usePlayerMark(p.id)
  const active = useForge((s) => s.game?.activePlayerId === p.id)
  const attacked = useForge((s) => !!s.combat?.bands.some((b) => b.defender?.kind === 'player' && b.defender.id === p.id))
  const after = useForge((s) => s.combatAssist?.players.find((x) => x.id === p.id))
  const ribbon = useRibbonCards(isMe ? undefined : p)
  const sources = useMemo(() => ribbonSources(ribbon), [ribbon])
  const open = useOpenMana(isMe ? undefined : p, sources)
  const hits = useCommanderHits(p)
  const counters = Object.entries(p.counters).filter(([, n]) => n > 0)
  const rim: ShieldRim = attacked ? 'ember' : active ? (isMe ? 'bright' : 'active') : 'metal'
  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, opacity: p.hasLost ? 0.5 : 1 }}>
        <button
          type="button"
          data-entity={`player:${p.id}`}
          title={mark === 'choose' ? `Choose ${p.name}` : `${p.name}: ${p.life} life`}
          style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer', filter: mark ? MARK_SHADOW[mark] : undefined, flex: 'none' }}
          onClick={(e) => clickPlayer(e, p.id)}
          onContextMenu={(e) => clickPlayer(e, p.id)}
        >
          <LifeShield life={p.life} preview={after?.lifeAfter ?? null} lethal={!!after?.lethal} poison={p.poison} width={48} rim={rim} commander={hits} />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div className="lk-title" style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
          <OppZones player={p} />
        </div>
      </div>
    )
  }
  const sub = isMe ? null : attacked || active ? (
    <span style={{ color: open ? 'var(--lk-ember-light)' : undefined }}>{open} open · {p.handCount} in hand</span>
  ) : (
    `${p.handCount} in hand · ${p.libraryCount} library`
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: p.hasLost ? 0.5 : 1 }}>
      <button
        type="button"
        data-entity={`player:${p.id}`}
        title={mark === 'choose' ? `Choose ${isMe ? 'yourself' : p.name}` : `${p.name}: ${p.life} life`}
        style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer', filter: mark ? MARK_SHADOW[mark] : undefined, flex: 'none' }}
        onClick={(e) => clickPlayer(e, p.id)}
        onContextMenu={(e) => clickPlayer(e, p.id)}
      >
        <LifeShield life={p.life} preview={after?.lifeAfter ?? null} lethal={!!after?.lethal} poison={p.poison} width={isMe ? 92 : 80} rim={rim} commander={hits} />
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div className="lk-title" style={{ fontWeight: 700, fontSize: 24, lineHeight: 1, whiteSpace: 'nowrap' }}>{isMe ? 'You' : p.name}</div>
        {sub && <div style={{ fontSize: 14, color: 'var(--lk-parchment-dim)', whiteSpace: 'nowrap' }}>{sub}</div>}
        {!isMe && <OppZones player={p} />}
        {counters.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {counters.map(([k, n]) => (
              <span key={k} className="lk-title" style={chip}>
                {k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' ')} <b>{n}</b>
              </span>
            ))}
          </div>
        )}
        <Pool player={p} isMe={isMe} />
      </div>
    </div>
  )
}

const NO_HITS: CommanderHit[] = []

/** Commander damage this player took, per commander (server: PlayerDto.commanderDamage). */
function useCommanderHits(p: PlayerDto): CommanderHit[] {
  const names = useForge(useShallow((s) => (p.commanderDamage ?? []).map((d) => s.cards[d.cardId]?.name.split(',')[0] ?? 'Commander')))
  return useMemo(() => (p.commanderDamage?.length ? p.commanderDamage.map((d, i) => ({ name: names[i], amount: d.damage })) : NO_HITS), [p.commanderDamage, names])
}

const chip: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 8px', borderRadius: 999, background: 'var(--lk-chip)', boxShadow: '0 0 0 1px var(--lk-metal-line)', fontSize: 13, lineHeight: '22px', whiteSpace: 'nowrap' }

/** Floating mana; yours can be spent by clicking it. */
function Pool({ player: p, isMe }: { player: PlayerDto; isMe: boolean }) {
  const pool = MANA.filter((c) => p.mana[c] > 0)
  if (!pool.length) return null
  return (
    <div title="Floating mana" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {pool.map((c) => (
        <button
          key={c}
          type="button"
          disabled={!isMe}
          title={isMe ? `Spend ${c} from your pool` : undefined}
          onClick={(e) => {
            e.stopPropagation()
            send({ t: 'useMana', color: c })
          }}
          className="lk-title"
          style={{ ...chip, cursor: isMe ? 'pointer' : 'default', color: 'var(--lk-parchment)', fontWeight: 700, fontSize: 15, padding: '2px 8px 2px 3px', boxShadow: '0 0 0 1.5px var(--lk-frost), 0 0 10px var(--lk-frost-soft)', border: 0 }}
        >
          <ManaSymbol sym={c} size={18} shadow={false} />
          {p.mana[c]}
        </button>
      ))}
    </div>
  )
}

type Zone = 'graveyard' | 'exile' | 'command'
const ZONE_TITLE = { graveyard: 'Graveyard', exile: 'Exile', command: 'Command', hand: 'Hand' }

function useZoneMark(ids: number[]) {
  return useForge((s) => (ids.some((id) => s.selectable.cardIds.has(id)) ? 'choose' : !s.selectable.cardIds.size && ids.some((id) => s.playable.has(id)) ? 'playable' : null))
}

function OppZones({ player: p }: { player: PlayerDto }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13.5, color: 'var(--lk-parchment-dim)', position: 'relative' }}>
      {(['graveyard', 'exile', 'command'] as const).map((z) => (p.zones[z].length ? <ZoneLink key={z} player={p} zone={z} /> : null))}
    </div>
  )
}

function ZoneLink({ player: p, zone }: { player: PlayerDto; zone: Zone }) {
  const ids = p.zones[zone]
  const mark = useZoneMark(ids)
  const view = useBoardUi((s) => s.zoneView)
  const setZoneView = useBoardUi((s) => s.setZoneView)
  const open = view?.playerId === p.id && view.zone === zone
  return (
    <span style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setZoneView(open ? null : { playerId: p.id, zone })
        }}
        style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: mark === 'choose' ? 'var(--lk-gold)' : mark === 'playable' ? 'var(--lk-frost)' : 'inherit', font: 'inherit' }}
      >
        {zone === 'graveyard' ? 'GY' : ZONE_TITLE[zone]} <b className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{ids.length}</b>
      </button>
      {open && <ZoneViewer player={p} zone={zone} up={false} />}
    </span>
  )
}

/** Your library, graveyard, exile and command zone as piles; the piles open a viewer. */
export function Piles({ player: p }: { player: PlayerDto }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <Pile n={p.libraryCount} label="Library" back />
      <Pile n={p.zones.graveyard.length} label="Graveyard" player={p} zone="graveyard" />
      {p.zones.exile.length > 0 && <Pile n={p.zones.exile.length} label="Exile" player={p} zone="exile" />}
      {p.zones.command.length > 0 && <Pile n={p.zones.command.length} label="Command" player={p} zone="command" />}
    </div>
  )
}

const NO_IDS: number[] = []

function Pile({ n, label, back, player, zone }: { n: number; label: string; back?: boolean; player?: PlayerDto; zone?: Zone }) {
  const ids = player && zone ? player.zones[zone] : NO_IDS
  const mark = useZoneMark(ids)
  const view = useBoardUi((s) => s.zoneView)
  const setZoneView = useBoardUi((s) => s.setZoneView)
  const open = !!player && view?.playerId === player.id && view.zone === zone
  const topId = ids[ids.length - 1]
  const top = useForge((s) => (topId != null ? s.cards[topId] : undefined))
  const ring = mark === 'choose' ? RING.choose : mark === 'playable' ? RING.playable : null
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }} title={`${label}: ${n}`}>
      <button
        type="button"
        disabled={!zone || n === 0}
        onClick={(e) => {
          e.stopPropagation()
          if (player && zone) setZoneView(open ? null : { playerId: player.id, zone })
        }}
        className="lk-title"
        style={{
          position: 'relative', width: 70, height: 98, borderRadius: 6, border: 0, padding: 0, overflow: 'hidden', cursor: zone && n ? 'pointer' : 'default', color: 'var(--lk-parchment)',
          background: back ? 'repeating-linear-gradient(45deg,#3b2a1a 0 5px,#2e2014 5px 10px)' : 'rgb(10 8 6 / .5)',
          boxShadow: [back ? '0 0 0 1.5px var(--lk-ink), 0 0 0 3px var(--lk-metal-dark)' : 'inset 0 0 0 1.5px var(--lk-metal-line)', ring].filter(Boolean).join(', '),
        }}
      >
        {top && <span style={{ position: 'absolute', inset: 0, opacity: 0.55 }}><CardImage card={top} width={70} bare /></span>}
        <span style={{ position: 'absolute', left: 0, right: 0, bottom: 4, fontWeight: 700, fontSize: 18, textShadow: '0 2px 0 rgb(0 0 0 / .8)' }}>{n}</span>
      </button>
      <span className="lk-label" style={{ fontSize: 13, color: 'var(--lk-parchment-dim)' }}>{label}</span>
      {open && player && zone && <ZoneViewer player={player} zone={zone} up />}
    </div>
  )
}

function ZoneViewer({ player, zone, up }: { player: PlayerDto; zone: Zone; up: boolean }) {
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
  const cw = 120
  const cols = Math.min(5, Math.max(2, list.length))
  const place: CSSProperties = up ? { right: 0, bottom: '100%', marginBottom: 12 } : { left: 0, top: '100%', marginTop: 8 }
  return (
    <div
      data-zone-viewer
      className="bf-pop lk-text"
      style={{ position: 'absolute', ...place, zIndex: 60, display: 'flex', flexDirection: 'column', maxHeight: 'min(76vh, 640px)', width: cols * (cw + 10) + 30, borderRadius: 14, background: 'linear-gradient(#211a13, var(--lk-ink-2))', boxShadow: '0 0 0 2px var(--lk-ink), 0 0 0 3.5px var(--lk-metal), 0 16px 34px rgb(0 0 0 / .65)', color: 'var(--lk-parchment)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '12px 16px 8px', borderBottom: '1px solid var(--lk-metal-line)' }}>
        <span className="lk-title" style={{ fontWeight: 700, fontSize: 18 }}>{ZONE_TITLE[zone]}</span>
        <span style={{ fontSize: 15, color: 'var(--lk-parchment-dim)', flex: 1 }}>{player.isAI ? player.name : 'Yours'} · {list.length}</span>
        <button type="button" title="Close" onClick={() => setZoneView(null)} style={{ border: 0, background: 'none', color: 'var(--lk-parchment-dim)', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>
      <div className="bf-scroll" style={{ display: 'grid', gap: 10, overflowY: 'auto', padding: 14, gridTemplateColumns: `repeat(${cols}, ${cw}px)` }}>
        {list.map((c) => <ZoneCard key={c.id} card={c} w={cw} />)}
      </div>
    </div>
  )
}

function ZoneCard({ card, w }: { card: CardDto; w: number }) {
  const { highlight } = useCardLook([card.id], card)
  const peek = usePeek({ kind: 'card', id: card.id })
  return (
    <div
      data-zone-card={card.id}
      tabIndex={0}
      style={{ borderRadius: 7, cursor: 'pointer', boxShadow: highlight ? RING[highlight] : undefined }}
      {...peek}
      onClick={(e) => clickCards(e, [card.id])}
      onContextMenu={(e) => clickCards(e, [card.id])}
    >
      <CardImage card={card} width={w} />
    </div>
  )
}

function stripStatus(s: ForgeState, id: number): SeatStatus {
  const combat = !!s.combat?.bands.length
  if (s.game?.activePlayerId === id) return combat ? 'attacking' : 'active'
  if (combat && s.combat!.bands.some((b) => b.defender?.kind === 'player' && b.defender.id === id)) return 'defending'
  return 'waiting'
}

/** Multiplayer: an opponent not drawn full size. Click focuses it; while choosing (or with shift) it's the player. */
export function StripSeat({ player: p, width, onFocus }: { player: PlayerDto; width: number; onFocus: () => void }) {
  const mark = usePlayerMark(p.id)
  const status = useForge((s) => stripStatus(s, p.id))
  const preview = useForge((s) => s.combatAssist?.players.find((x) => x.id === p.id)?.lifeAfter ?? null)
  const cards = useRibbonCards(p)
  const sources = useMemo(() => ribbonSources(cards), [cards])
  const colors = useSeatColors(p)
  const hits = useCommanderHits(p)
  const cmd = p.commanders?.[0]
  const cmdName = useForge((s) => (cmd ? (s.cards[cmd.cardId]?.name.split(',')[0] ?? 'Commander') : null))
  return (
    <div
      role="button"
      tabIndex={0}
      data-entity={`player:${p.id}`}
      title={mark === 'choose' ? `Choose ${p.name}` : 'Click to show this board'}
      style={{ cursor: 'pointer', borderRadius: 14, filter: mark ? MARK_SHADOW[mark] : undefined }}
      onClick={(e) => {
        if (e.shiftKey || mark === 'choose') clickPlayer(e, p.id)
        else onFocus()
      }}
      onContextMenu={(e) => clickPlayer(e, p.id)}
    >
      <SeatStrip player={p} colors={colors} status={status} open={sources} preview={preview} width={width} commander={cmd && cmdName ? { name: cmdName, tax: cmd.tax } : undefined} cmdDamage={hits.length ? hits : undefined} />
    </div>
  )
}
