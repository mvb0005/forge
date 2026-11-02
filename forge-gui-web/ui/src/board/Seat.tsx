import { useEffect, useMemo, type CSSProperties, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CardFrame, RING } from '../look/CardFrame'
import type { CommanderHit } from '../look/LifeShield'
import { foldLands, type RibbonSource } from '../look/ManaRibbon'
import { ManaSymbol } from '../look/ManaSymbol'
import { Face } from './Face'
import { LandTray } from './LandTray'
import { SHELF_INSET, isRock, isShelfCard, rockSym, trayGroups, type TrayGroup } from './lands'
import { boardIdentity, identity } from '../look/tones'
import { send } from '../net'
import { usePeek } from '../popover/usePeek'
import type { CardDto, ManaColor, PlayerDto, ZoneName } from '../protocol'
import type { Region } from '../table/contract'
import { COMMAND } from '../table/layouts'
import { useForge, type ForgeState } from '../store'
import { CardImage } from './CardImage'
import { pickFromGroup } from './layout'
import { clickCards, useCardLook } from './Tile'
import { useBoardUi } from './uiStore'

// Seat chrome in the look: the life shield and name (clickable as a player), floating mana, the land
// shelf, your piles, and multiplayer seat strips. Everything here only displays the store.

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

/** Lands folded by the mana they make, then mana rocks (presentation, from type line and text). */
export function ribbonSources(cards: CardDto[]): RibbonSource[] {
  const rocks = cards.filter(isRock).map((c) => ({ sym: rockSym(c), untapped: c.tapped ? 0 : 1, total: 1, label: c.name, ids: [c.id] }))
  return [...foldLands(cards), ...rocks]
}

/** The cards a land shelf is made of: lands and mana rocks only, so a creature's P/T change doesn't touch it. */
export function useRibbonCards(p: PlayerDto | undefined) {
  return useForge(useShallow((s: ForgeState) => (p ? p.zones.battlefield.map((id) => s.cards[id]).filter((c) => c && isShelfCard(c)) : [])))
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

/**
 * A player's land shelf, in the region the layout carved off the right of their battlefield. Your usable stacks
 * glow frost while you hold priority or the engine lists one of their lands as playable. Yours sits low and an
 * opponent's high: the back of the table, where lands go.
 */
export function Ribbon({ player, isMe, style }: { player: PlayerDto; isMe: boolean; compact?: boolean; style?: CSSProperties }) {
  const cards = useRibbonCards(player)
  const groups = useMemo(() => trayGroups(cards), [cards])
  const sources = useMemo(() => ribbonSources(cards), [cards])
  const open = useOpenMana(player, sources)
  const usable = useForge((s) => isMe && s.game?.priorityPlayerId != null && s.game.localPlayerIds.includes(s.game.priorityPlayerId))
  const playable = useForge((s) => s.playable)
  const opened = useBoardUi((s) => s.openLands.includes(player.id))
  const toggle = useBoardUi((s) => s.toggleLands)
  const glow = useMemo(() => (isMe ? (g: TrayGroup) => usable || g.open.some((id) => playable.has(id)) : undefined), [isMe, usable, playable])
  const w = typeof style?.width === 'number' ? style.width : 0
  const h = typeof style?.height === 'number' ? style.height : 110
  return (
    <div style={{ ...style, display: 'flex', alignItems: isMe ? 'flex-end' : 'flex-start', justifyContent: 'flex-end', paddingRight: SHELF_INSET, boxSizing: 'border-box', overflow: 'visible' }}>
      <LandTray groups={groups} w={w} h={h} open={open} glow={glow} opened={opened} onToggle={() => toggle(player.id)} onPick={isMe ? pickIds : undefined} />
    </div>
  )
}

function pickIds(ids: number[]) {
  const s = useForge.getState()
  const open = ids.filter((id) => !s.cards[id]?.tapped)
  const { cardId } = pickFromGroup(open.length ? open : ids, s.cards, s.selectable.cardIds, s.playable, s.highlighted)
  if (cardId != null) send({ t: 'selectCard', cardId, shift: false, button: 1 })
}

type Fact = { key: string; text: string; danger?: boolean }

function playerFacts(p: PlayerDto, hits: CommanderHit[], mana: number | null): Fact[] {
  const out: Fact[] = []
  if (p.poison > 0) out.push({ key: 'poison', text: `Poison ${p.poison}`, danger: true })
  for (const h of hits) if (h.amount > 0) out.push({ key: `cmd:${h.name}`, text: `${h.name} ${h.amount}`, danger: true })
  for (const [k, n] of Object.entries(p.counters)) {
    if (n > 0) out.push({ key: k, text: `${k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' ')} ${n}` })
  }
  if (mana != null) out.push({ key: 'mana', text: `Mana ${mana}` })
  return out
}

/** The same plaque at every seat: life, name, hand, library, then whatever the game has changed. */
export function SeatPlate({ player: p, isMe, compact = false }: { player: PlayerDto; isMe: boolean; compact?: boolean }) {
  const mark = usePlayerMark(p.id)
  const active = useForge((s) => s.game?.activePlayerId === p.id)
  const phase = useForge((s) => s.game?.phase ?? null)
  const spectating = useForge((s) => !!s.game && s.game.localPlayerIds.length === 0)
  const attacked = useForge((s) => !!s.combat?.bands.some((b) => b.defender?.kind === 'player' && b.defender.id === p.id))
  const after = useForge((s) => s.combatAssist?.players.find((x) => x.id === p.id)?.lifeAfter ?? null)
  const ribbon = useRibbonCards(isMe ? undefined : p)
  const sources = useMemo(() => ribbonSources(ribbon), [ribbon])
  const open = useOpenMana(isMe ? undefined : p, sources)
  const hits = useCommanderHits(p)
  const facts = playerFacts(p, hits, compact && !isMe ? open : null)
  const declaring = phase === 'COMBAT_DECLARE_ATTACKERS'
  const underAttack = attacked || (mark === 'chosen' && declaring)
  const edge = mark === 'choose' ? 'var(--lk-gold)' : underAttack ? 'var(--lk-ember)' : active ? 'var(--lk-parchment)' : 'transparent'
  const preview = after != null && after !== p.life ? after : null
  const lifeColor = underAttack || (preview != null && preview < p.life)
    ? 'var(--lk-ember)'
    : mark === 'choose' || mark === 'chosen'
      ? 'var(--lk-gold)'
      : 'inherit'
  return (
    <div
      onClick={(e) => { if (mark === 'choose' || mark === 'chosen') clickPlayer(e, p.id) }}
      onContextMenu={(e) => clickPlayer(e, p.id)}
      style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 12, minWidth: 0, maxWidth: '100%', padding: compact ? '2px 6px' : '6px 8px 6px 6px', borderRadius: 8, background: 'rgb(16 12 9 / .55)', boxShadow: `inset 3px 0 0 ${edge}`, opacity: p.hasLost ? 0.45 : 1, cursor: mark ? 'pointer' : undefined }}>
      <button
        type="button"
        data-entity={`player:${p.id}`}
        title={mark === 'choose' ? `Choose ${isMe ? 'yourself' : p.name}` : `${p.name}: ${p.life} life`}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, border: 0, padding: 0, background: 'none', cursor: 'pointer', filter: mark ? MARK_SHADOW[mark] : undefined, flex: 'none', color: lifeColor }}
        onClick={(e) => clickPlayer(e, p.id)}
        onContextMenu={(e) => clickPlayer(e, p.id)}
      >
        <span className="lk-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, fontSize: compact ? 26 : 34, lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
          {(underAttack || (mark === 'choose' && declaring)) && <AttackGlyph size={compact ? 15 : 19} />}
          {preview ?? p.life}
        </span>
        {preview != null && <span style={{ fontSize: 10, color: 'var(--lk-parchment-mute)', textDecoration: 'line-through' }}>{p.life}</span>}
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div className="lk-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: compact ? 15 : 18, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{isMe && !spectating ? 'You' : p.name}</span>
          {spectating && p.isAI && !p.hasLost && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                send({ t: 'takeOver', playerId: p.id })
              }}
              className="lk-title"
              style={{ pointerEvents: 'auto', flex: 'none', border: '1px solid var(--lk-gold-soft)', borderRadius: 3, background: 'rgb(245 213 138 / .14)', color: 'var(--lk-gold)', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '1px 7px', lineHeight: '16px' }}
            >
              Take over
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: compact ? 11 : 12, color: 'var(--lk-parchment-dim)', whiteSpace: 'nowrap' }}>
          <span>Hand <b className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{p.handCount}</b></span>
          <span>Library <b className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{p.libraryCount}</b></span>
        </div>
        {facts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {facts.map((f) => (
              <span key={f.key} style={{ ...chip, color: f.danger ? 'var(--lk-ember-light)' : undefined }}>{f.text}</span>
            ))}
          </div>
        )}
        {!compact && !isMe && <OppZones player={p} />}
        {!compact && <Pool player={p} isMe={isMe} />}
      </div>
    </div>
  )
}

const NO_HITS: CommanderHit[] = []

/**
 * A player's border (3-4 players): the framed left end of their band. Life (with the combat preview) and name,
 * hand and library, then whatever the game has changed; the command zone sits at its right edge (the card
 * layer draws the commanders there). Its edge is their colour identity; the active player's is lit, and an
 * attacked player's turns ember.
 */
export function PlayerBorder({ player: p, isMe, region, cmdW, turn, bodyH }: { player: PlayerDto; isMe: boolean; region: Region; cmdW: number; turn: number; bodyH?: number }) {
  const mark = usePlayerMark(p.id)
  const active = useForge((s) => s.game?.activePlayerId === p.id)
  const priority = useForge((s) => s.game?.priorityPlayerId === p.id)
  const phase = useForge((s) => s.game?.phase ?? null)
  const local = useForge((s) => !!s.game?.localPlayerIds.includes(p.id))
  const spectating = useForge((s) => !!s.game && s.game.localPlayerIds.length === 0)
  const attacked = useForge((s) => !!s.combat?.bands.some((b) => b.defender?.kind === 'player' && b.defender.id === p.id))
  const after = useForge((s) => s.combatAssist?.players.find((x) => x.id === p.id)?.lifeAfter ?? null)
  const viewing = useBoardUi((s) => s.zoneView?.playerId === p.id)
  const setFocus = useBoardUi((s) => s.setFocus)
  const colors = useSeatColors(p)
  const ribbon = useRibbonCards(isMe ? undefined : p)
  const sources = useMemo(() => ribbonSources(ribbon), [ribbon])
  const open = useOpenMana(isMe ? undefined : p, sources)
  const hits = useCommanderHits(p)
  const facts = playerFacts(p, hits, isMe ? null : open)
  const preview = after != null && after !== p.life ? after : null
  const declaring = phase === 'COMBAT_DECLARE_ATTACKERS'
  const attackPick = mark === 'choose' && declaring
  const underAttack = attacked || (mark === 'chosen' && declaring)
  const edge = attackPick ? 'var(--lk-gold)' : underAttack ? 'var(--lk-ember)' : mark === 'chosen' ? 'var(--lk-gold)' : active ? 'var(--lk-parchment)' : 'var(--lk-metal-line)'
  const lifeColor = underAttack || (preview != null && preview < p.life)
    ? 'var(--lk-ember)'
    : mark === 'choose' || mark === 'chosen'
      ? 'var(--lk-gold)'
      : 'var(--lk-parchment)'
  const tall = (bodyH ?? region.h) >= 168
  const pips = (colors || 'C').split('')
  return (
    <div
      onClick={(e) => {
        if (e.shiftKey || mark === 'choose' || mark === 'chosen') clickPlayer(e, p.id)
        else setFocus(p.id, turn)
      }}
      onContextMenu={(e) => clickPlayer(e, p.id)}
      title={attackPick ? `Attack ${local ? 'yourself' : p.name}` : mark === 'choose' ? `Choose ${local ? 'yourself' : p.name}` : `${p.name}: ${p.life} life`}
      style={{
        position: 'absolute', left: region.x + 4, top: region.y + 3, width: region.w - 8, height: region.h - 6, zIndex: viewing ? 40 : 8, boxSizing: 'border-box',
        borderRadius: 6, background: underAttack ? 'linear-gradient(180deg, rgb(52 24 18 / .95), rgb(18 11 9 / .95))' : 'linear-gradient(180deg, rgb(28 22 16 / .94), rgb(14 11 8 / .94))',
        boxShadow: `inset 0 0 0 ${attackPick || underAttack || mark === 'chosen' ? 2 : 1.5}px ${edge}, 0 2px 10px rgb(0 0 0 / .45)${underAttack ? ', 0 0 18px var(--lk-ember-soft)' : active ? ', 0 0 18px rgb(242 234 214 / .12)' : ''}`,
        opacity: p.hasLost ? 0.5 : 1, cursor: 'pointer', overflow: 'visible',
      }}>
      <div style={{ position: 'absolute', left: 10, top: 6, right: cmdW + 6, ...(bodyH != null ? { height: Math.max(48, bodyH - 16) } : { bottom: 6 }), display: 'flex', flexDirection: 'column', gap: tall ? 4 : 2, minWidth: 0 }}>
        {(attackPick || underAttack) && (
          <div className="lk-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: tall ? 14 : 11.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: attackPick ? '#2c261c' : 'var(--lk-on-ember)', background: attackPick ? 'var(--lk-gold)' : 'var(--lk-ember)', borderRadius: 3, lineHeight: tall ? '24px' : '19px', padding: '0 6px' }}>
            <AttackGlyph size={tall ? 13 : 11} />
            <span>{attackPick ? `Attack ${local ? 'you' : p.name}` : `Attacking ${local ? 'you' : p.name}`}</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Face player={p} colors="C" size={tall ? 34 : 28} />
          <button
            type="button"
            data-entity={`player:${p.id}`}
            title={mark === 'choose' ? `Choose ${local ? 'yourself' : p.name}` : `${p.name}: ${p.life} life`}
            onClick={(e) => clickPlayer(e, p.id)}
            onContextMenu={(e) => clickPlayer(e, p.id)}
            className="lk-title"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, padding: 0, background: 'none', cursor: 'pointer', filter: mark ? MARK_SHADOW[mark] : undefined, flex: 'none', fontWeight: 700, fontSize: tall ? 34 : 28, lineHeight: 0.95, fontVariantNumeric: 'tabular-nums', color: lifeColor }}
          >
            {(underAttack || attackPick) && <AttackGlyph size={tall ? 20 : 16} />}
            <span>{preview ?? p.life}</span>
          </button>
          {preview != null && <span style={{ fontSize: 11, color: 'var(--lk-parchment-mute)', textDecoration: 'line-through' }}>{p.life}</span>}
          {priority && <span title="Holds priority" style={{ width: 7, height: 7, borderRadius: 99, flex: 'none', background: 'var(--lk-gold)', boxShadow: '0 0 8px var(--lk-gold-soft)', alignSelf: 'center' }} />}
          <span aria-label={`Color identity ${pips.join('')}`} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2, flex: 'none' }}>
            {pips.map((c) => <ManaSymbol key={c} sym={c} size={tall ? 15 : 13} />)}
          </span>
        </div>
        <div className="lk-title" title={p.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontWeight: 700, fontSize: 15, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--lk-parchment)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{local ? 'You' : p.name}</span>
          {spectating && p.isAI && !p.hasLost && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                send({ t: 'takeOver', playerId: p.id })
              }}
              className="lk-title"
              style={{ pointerEvents: 'auto', flex: 'none', border: '1px solid var(--lk-gold-soft)', borderRadius: 3, background: 'rgb(245 213 138 / .14)', color: 'var(--lk-gold)', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '1px 7px', lineHeight: '16px' }}
            >
              Take over
            </button>
          )}
        </div>
        <SeatZones player={p} isMe={isMe} piles={isMe && tall} />
        {facts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, overflow: 'hidden', maxHeight: tall ? undefined : 22 }}>
            {facts.map((f) => (
              <span key={f.key} style={{ ...chip, fontSize: 11.5, lineHeight: '19px', padding: '0 6px', color: f.danger ? 'var(--lk-ember-light)' : undefined }}>{f.text}</span>
            ))}
          </div>
        )}
        <Pool player={p} isMe={isMe} />
      </div>
    </div>
  )
}

/** A small crown, the command zone's mark. */
function CommandGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden style={{ flex: 'none' }}>
      <path d="M1 9.5 L1.6 3.5 L4.2 6 L6 2 L7.8 6 L10.4 3.5 L11 9.5 Z" fill="var(--lk-brass)" stroke="var(--lk-ink)" strokeWidth="0.7" strokeLinejoin="round" />
    </svg>
  )
}

/** Crossed swords, the attack mark on a seat. */
function AttackGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden style={{ flex: 'none' }}>
      <path d="M2 2 L12 12 M9.5 12 L12 9.5 M12 2 L2 12 M2 9.5 L4.5 12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Every player's command zone: a slot per commander at the left of their battlefield. While the commander
 * is here the card layer draws it in the slot; once it has been cast, a faded copy stays behind, saying
 * where it went, so every commander is always on the table. The chip under it says which, with the tax.
 */
export function CommandSlots({ regions }: { regions: Record<string, Region> }) {
  const meId = useForge((s) => s.game?.localPlayerIds[0])
  const seats = useForge(useShallow((s) => Object.values(s.players).flatMap((p) => (p.commanders ?? []).map((c) => `${p.id}:${c.cardId}:${c.tax}:${c.casts}`))))
  return (
    <>
      {seats.map((k) => {
        const [pid, id, tax, casts] = k.split(':').map(Number)
        const r = regions[`command:${id}`]
        return r ? <CommandSlot key={id} id={id} owner={pid} tax={tax} casts={casts} mine={pid === meId} r={r} inBorder={!!regions[`border:${pid}`] && r.x < regions[`border:${pid}`].x + regions[`border:${pid}`].w} /> : null
      })}
    </>
  )
}

function CommandSlot({ id, owner, tax, casts, mine, r, inBorder }: { id: number; owner: number; tax: number; casts: number; mine: boolean; r: Region; inBorder: boolean }) {
  const card = useForge((s) => s.cards[id])
  const who = useForge((s) => (mine ? 'You' : s.players[owner]?.name ?? ''))
  const castable = useForge((s) => mine && card?.zone === 'command' && !s.selectable.cardIds.size && s.playable.has(id))
  const peek = usePeek({ kind: 'card', id })
  if (!card) return null
  const home = card.zone === 'command'
  const status = home ? (casts === 0 ? 'Not cast' : 'Command zone') : ZONE_SHORT[card.zone] ?? card.zone
  return (
    <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h + (inBorder ? 0 : COMMAND.chipH), zIndex: 8, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: r.w, height: r.h, borderRadius: 7, background: 'rgb(10 8 6 / .45)', boxShadow: 'inset 0 0 0 1.5px var(--lk-metal-line)' }} />
      {!home && (
        // The commander is elsewhere: a faded copy holds its place. Hover peeks the real card, click finds it.
        <div {...peek} data-entity={`card:${id}`} onClick={(e) => clickCards(e, [id])}
          style={{ position: 'absolute', left: 0, top: 0, width: r.w, height: r.h, opacity: 0.38, filter: 'grayscale(.7)', pointerEvents: 'auto', cursor: 'pointer' }}>
          <CardFrame card={card} width={r.w} mini />
        </div>
      )}
      <span
        className="lk-title"
        title={`${status}. Commander tax: {2} more for each earlier cast from the command zone`}
        style={{
          position: 'absolute', left: '50%', top: inBorder ? r.h - 10 : r.h + 3, transform: 'translateX(-50%)', ...chip, display: 'flex', flexDirection: inBorder ? 'row' : 'column', alignItems: 'center',
          gap: inBorder ? 5 : undefined, padding: inBorder ? '0 6px' : '1px 8px', whiteSpace: 'nowrap', fontSize: inBorder ? 10 : 11, lineHeight: '14px', zIndex: inBorder ? 6000 : 1,
          color: castable ? 'var(--lk-frost)' : home ? 'var(--lk-parchment)' : 'var(--lk-parchment-dim)',
          boxShadow: castable ? '0 0 0 1.5px var(--lk-frost), 0 0 10px var(--lk-frost-soft)' : home ? '0 0 0 1.5px var(--lk-brass)' : chip.boxShadow,
        }}
      >
        {inBorder ? (
          <>{home && <CommandGlyph size={10} />}<span style={{ fontWeight: 700 }}>{home ? `Tax ${tax}` : status}</span></>
        ) : (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>{home && <CommandGlyph size={11} />}{who}</span>
            <span style={{ fontSize: 10, opacity: 0.85 }}>{status} · Tax {tax}</span>
          </>
        )}
      </span>
    </div>
  )
}

const ZONE_SHORT: Partial<Record<ZoneName, string>> = { battlefield: 'On battlefield', stack: 'Being cast', graveyard: 'In graveyard', exile: 'In exile', hand: 'In hand', library: 'In library' }

/** A zone's cards as the piles show them: the command zone leaves out commanders, which have their own slot or chip. */
function zoneIds(p: PlayerDto, zone: Zone) {
  const ids = p.zones[zone]
  if (zone !== 'command' || !p.commanders?.length) return ids
  const cmd = new Set(p.commanders.map((c) => c.cardId))
  return ids.filter((id) => !cmd.has(id))
}

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
      {(['graveyard', 'exile', 'command'] as const).map((z) => (zoneIds(p, z).length ? <ZoneLink key={z} player={p} zone={z} /> : null))}
    </div>
  )
}

function ZoneLink({ player: p, zone, zero = false }: { player: PlayerDto; zone: Zone; zero?: boolean }) {
  const ids = useMemo(() => zoneIds(p, zone), [p, zone])
  const mark = useZoneMark(ids)
  const view = useBoardUi((s) => s.zoneView)
  const setZoneView = useBoardUi((s) => s.setZoneView)
  const open = view?.playerId === p.id && view.zone === zone
  if (!zero && !ids.length) return null
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
      {zoneIds(p, 'command').length > 0 && <Pile n={zoneIds(p, 'command').length} label="Command" player={p} zone="command" />}
    </div>
  )
}

const NO_IDS: number[] = []

/** Library, graveyard and exile inside the seat. Yours are piles when the band is tall; everyone else gets counts. */
function SeatZones({ player: p, isMe, piles }: { player: PlayerDto; isMe: boolean; piles: boolean }) {
  if (piles) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 'auto' }}>
        <span style={{ fontSize: 12, color: 'var(--lk-parchment-dim)' }}>Hand <b className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{p.handCount}</b></span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Pile n={p.libraryCount} label="Library" back mini />
          <Pile n={p.zones.graveyard.length} label="Graveyard" player={p} zone="graveyard" mini />
          <Pile n={p.zones.exile.length} label="Exile" player={p} zone="exile" mini />
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: isMe ? 8 : 6, fontSize: isMe ? 12 : 10.5, color: 'var(--lk-parchment-dim)', whiteSpace: 'nowrap' }}>
      <span>Hand <b className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{p.handCount}</b></span>
      <span>Lib <b className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{p.libraryCount}</b></span>
      <ZoneLink player={p} zone="graveyard" zero />
      <ZoneLink player={p} zone="exile" zero />
    </div>
  )
}

function Pile({ n, label, back, player, zone, mini = false }: { n: number; label: string; back?: boolean; player?: PlayerDto; zone?: Zone; mini?: boolean }) {
  const ids = useMemo(() => (player && zone ? zoneIds(player, zone) : NO_IDS), [player, zone])
  const mark = useZoneMark(ids)
  const view = useBoardUi((s) => s.zoneView)
  const setZoneView = useBoardUi((s) => s.setZoneView)
  const open = !!player && view?.playerId === player.id && view.zone === zone
  const topId = ids[ids.length - 1]
  const top = useForge((s) => (topId != null ? s.cards[topId] : undefined))
  const ring = mark === 'choose' ? RING.choose : mark === 'playable' ? RING.playable : null
  const w = mini ? 46 : 70
  const h = mini ? 64 : 98
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: mini ? 2 : 6 }} title={`${label}: ${n}`}>
      <button
        type="button"
        disabled={!zone || n === 0}
        onClick={(e) => {
          e.stopPropagation()
          if (player && zone) setZoneView(open ? null : { playerId: player.id, zone })
        }}
        className="lk-title"
        style={{
          position: 'relative', width: w, height: h, borderRadius: 6, border: 0, padding: 0, overflow: 'hidden', cursor: zone && n ? 'pointer' : 'default', color: 'var(--lk-parchment)',
          background: back ? 'repeating-linear-gradient(45deg,#3b2a1a 0 5px,#2e2014 5px 10px)' : 'rgb(10 8 6 / .5)',
          boxShadow: [back ? '0 0 0 1.5px var(--lk-ink), 0 0 0 3px var(--lk-metal-dark)' : 'inset 0 0 0 1.5px var(--lk-metal-line)', ring].filter(Boolean).join(', '),
        }}
      >
        {top && <span style={{ position: 'absolute', inset: 0, opacity: 0.55 }}><CardImage card={top} width={w} bare /></span>}
        <span style={{ position: 'absolute', left: 0, right: 0, bottom: mini ? 2 : 4, fontWeight: 700, fontSize: mini ? 14 : 18, textShadow: '0 2px 0 rgb(0 0 0 / .8)' }}>{n}</span>
      </button>
      <span className="lk-label" style={{ fontSize: mini ? 10 : 13, color: 'var(--lk-parchment-dim)' }}>{mini ? (label === 'Library' ? 'Lib' : label === 'Graveyard' ? 'GY' : 'Ex') : label}</span>
      {open && player && zone && <ZoneViewer player={player} zone={zone} up />}
    </div>
  )
}

function ZoneViewer({ player, zone, up }: { player: PlayerDto; zone: Zone; up: boolean }) {
  const cards = useForge((s) => s.cards)
  const setZoneView = useBoardUi((s) => s.setZoneView)
  const list = useMemo(() => [...zoneIds(player, zone)].reverse().map((id) => cards[id]).filter((c): c is CardDto => !!c), [player, zone, cards])
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
  const place: CSSProperties = up ? { right: 0, bottom: '100%', marginBottom: 12 } : { right: 0, top: '100%', marginTop: 8 }
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

/** Multiplayer: an opponent not drawn full size. The plaque matches the seats on the table. Click focuses it. */
export function StripSeat({ player: p, width, onFocus }: { player: PlayerDto; width: number; onFocus: () => void }) {
  const mark = usePlayerMark(p.id)
  return (
    <div
      role="button"
      tabIndex={0}
      title={mark === 'choose' ? `Choose ${p.name}` : 'Click to show this board'}
      style={{ width, cursor: 'pointer', borderRadius: 8, filter: mark ? MARK_SHADOW[mark] : undefined }}
      onClick={(e) => {
        if (e.shiftKey || mark === 'choose') clickPlayer(e, p.id)
        else onFocus()
      }}
      onContextMenu={(e) => clickPlayer(e, p.id)}
    >
      <SeatPlate player={p} isMe={false} compact />
    </div>
  )
}
