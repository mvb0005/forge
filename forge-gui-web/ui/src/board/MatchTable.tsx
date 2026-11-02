import { useRef, type CSSProperties, type ReactNode } from 'react'
import { stepWords } from '../look/phase'
import { TableHalf, TableMat } from '../look/TableHalf'
import { PromptHeadline } from '../shell/PromptBar'
import type { Region } from '../table/contract'
import { ACT_BUTTONS_H } from '../table/frame'
import { CardLayer, useTableLayout } from '../table/CardLayer'
import { useForge } from '../store'
import { Arrows } from './Arrows'
import { Arena } from './Arena'
import { BlockSlots } from './CombatArena'
import { Face } from './Face'
import { Scoreboard } from './Scoreboard'
import { SidePanel } from './Preview'
import { CommandSlots, Piles, PlayerBorder, Ribbon, SeatPlate, StripSeat, useSeatColors } from './Seat'
import { useBoardUi } from './uiStore'
import { useSize } from './useSize'
import './board.css'

// A seat or pile whose zone viewer is open comes above the card layer (z 10) and the control panel (22):
// the viewer's own z-index only counts inside its wrapper.
const RAISED = 40

const at = (r: Region | undefined): CSSProperties => (r ? { position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h } : { display: 'none' })

function ActionPlate({ act, seat, headline, children }: { act: Region; seat?: Region; headline: boolean; children: ReactNode }) {
  const inside = seat != null
  return (
    <div
      style={inside
        ? { position: 'absolute', left: seat.x + 14, width: seat.w - 28, top: seat.y + seat.h - ACT_BUTTONS_H - 12, height: ACT_BUTTONS_H, zIndex: 22 }
        : { ...at(act), zIndex: 22, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10 }}
    >
      {headline && <PromptHeadline />}
      <div style={{ height: inside ? '100%' : ACT_BUTTONS_H, flex: 'none' }}>{children}</div>
    </div>
  )
}

function ColumnMat({ playerId, region, turn, extend }: { playerId: number; region: Region; turn: number; extend?: boolean }) {
  const active = useForge((s) => s.game?.activePlayerId === playerId)
  const setFocus = useBoardUi((s) => s.setFocus)
  return (
    <div onClick={() => setFocus(playerId, turn)} style={{ position: 'absolute', left: region.x, top: region.y, width: region.w, height: extend ? `calc(100% - ${region.y}px)` : region.h, cursor: 'pointer' }}>
      <TableHalf colors="C" active={active} side={extend ? 'bottom' : 'top'} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

function ColumnSeat({ playerId, seat, ribbon, turn, isMe, regions }: { playerId: number; seat: Region; ribbon: Region; turn: number; isMe: boolean; regions: Record<string, Region> }) {
  const player = useForge((s) => s.players[playerId])
  if (!player) return null
  const slot = player.commanders?.length ? regions[`command:${player.commanders[0].cardId}`] : undefined
  const inside = !!slot && slot.x + slot.w > seat.x && slot.x < seat.x + seat.w
  const cmdW = inside && slot ? seat.x + seat.w - slot.x : 0
  const bandH = regions[`half:${playerId}`]?.h
  // Your seat runs to the bottom of the screen. The profile stays with the band; the buttons fill the rest.
  const bodyH = isMe && bandH != null && seat.h > bandH + 24 ? bandH : undefined
  return (
    <>
      <PlayerBorder player={player} isMe={isMe} region={seat} cmdW={cmdW} turn={turn} bodyH={bodyH} />
      <Ribbon player={player} isMe={isMe} compact style={{ ...at(ribbon), display: 'flex', justifyContent: 'center', alignItems: isMe ? 'flex-end' : 'flex-start', zIndex: 4, overflow: 'visible' }} />
    </>
  )
}

// The whole table: two coloured halves, a scoreboard on the active player's mat, seats, mana
// ribbons, the combat ring, the control panel and the log. The chrome is placed from the layout's
// regions; every card is drawn by the card layer. centerSlot is the control panel.
export function MatchTable({ centerSlot }: { centerSlot: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { W, H } = useSize(rootRef)
  const viewport = { w: W, h: H }
  const { layout, meId, focusId } = useTableLayout(viewport)
  const players = useForge((s) => s.players)
  const game = useForge((s) => s.game)
  const pip = useForge((s) => s.pip)
  const mini = pip || (W > 0 && (W < 560 || H < 340))
  const turn = game?.turn ?? 0
  const setFocus = useBoardUi((s) => s.setFocus)
  const viewing = useBoardUi((s) => s.zoneView?.playerId)
  const raise = (id: number) => (viewing === id ? RAISED : 8)
  const me = meId != null ? players[meId] : undefined
  const opp = focusId != null ? players[focusId] : undefined
  const strips = Object.values(players)
    .filter((p) => p.id !== meId && p.id !== focusId)
    .sort((a, b) => a.id - b.id)
  const r = layout.regions
  const meColors = useSeatColors(me)
  const oppColors = useSeatColors(opp)
  const activeId = game?.activePlayerId ?? null
  const columns = Object.entries(r)
    .filter(([k]) => k.startsWith('half:'))
    .map(([k, half]) => ({ id: Number(k.slice(5)), half, seat: r[`seat:${k.slice(5)}`], ribbon: r[`ribbon:${k.slice(5)}`] }))
    .sort((a, b) => a.half.y - b.half.y || a.half.x - b.half.x)
  const meIsBand = meId != null && columns.some((c) => c.id === meId)
  const halves = r.split && (
    <>
      {columns.length > 0 ? (
        columns.map((c) => <ColumnMat key={c.id} playerId={c.id} region={c.half} turn={turn} extend={c.id === meId} />)
      ) : (
        <TableHalf colors={oppColors} active={activeId != null && activeId === focusId} side="top" style={{ position: 'absolute', left: 0, top: 0, width: r.split.w, height: r.split.y }} />
      )}
      {!meIsBand && (
        <TableHalf colors={meColors} active={activeId === meId} side="bottom" style={{ position: 'absolute', left: 0, top: r.split.y, width: r.split.w, height: H - r.split.y }} />
      )}
    </>
  )

  return (
    <div ref={rootRef} className="relative h-full w-full select-none overflow-hidden" style={{ background: 'var(--lk-ink)' }} onContextMenu={(e) => e.preventDefault()}>
      {mini ? (
        <MiniStatus />
      ) : (
        <>
          {W > 0 && r.split && (
            <TableMat halves={halves} style={{ position: 'absolute', left: 0, top: 0, width: r.split.w, height: H }}>
              {r.strips && (
                <div style={{ ...at(r.strips), display: 'flex', gap: 12, zIndex: 7 }}>
                  {strips.map((p) => (
                    <StripSeat key={p.id} player={p} width={Math.min(460, (r.strips.w - 12 * (strips.length - 1)) / Math.max(1, strips.length))} onFocus={() => setFocus(p.id, turn)} />
                  ))}
                </div>
              )}
              {columns.length === 0 && opp && (
                <div style={{ position: 'absolute', left: r.oppSeat.x + 12, top: r.oppSeat.y + 10, zIndex: raise(opp.id) }}>
                  <SeatPlate player={opp} isMe={false} />
                </div>
              )}
              {columns.length === 0 && opp && <Ribbon player={opp} isMe={false} style={{ ...at(r.oppRibbon), display: 'flex', justifyContent: 'center', alignItems: 'flex-start', zIndex: 4, overflow: 'visible' }} />}
              {columns.map((c) => c.seat && c.ribbon && <ColumnSeat key={c.id} playerId={c.id} seat={c.seat} ribbon={c.ribbon} turn={turn} isMe={c.id === meId} regions={r} />)}
              {me && !meIsBand && <Ribbon player={me} isMe style={{ ...at(r.meRibbon), display: 'flex', alignItems: 'flex-end', zIndex: 4, overflow: 'visible' }} />}
              <Arena layout={layout} />
              {game && !columns.length && <ScoreSpot meId={meId} multi={Object.keys(players).length > 2} x={r.oppSeat.x + 16} seam={r.line.y} lineH={r.line.h} />}
              <ActionPlate act={r.act} seat={meIsBand && meId != null ? r[`seat:${meId}`] : undefined} headline={!columns.length}>{centerSlot}</ActionPlate>
              {me && !meIsBand && (
                <div style={{ position: 'absolute', left: r.meSeat.x + 12, top: r.meSeat.y + 4, zIndex: raise(me.id) }}>
                  <SeatPlate player={me} isMe />
                </div>
              )}
              {me && !meIsBand && (
                <div style={{ ...at(r.piles), zIndex: raise(me.id), display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', padding: '0 10px 14px 0', boxSizing: 'border-box' }}>
                  <Piles player={me} />
                </div>
              )}
              <BlockSlots layout={layout} />
              <CommandSlots regions={r} />
              <CardLayer layout={layout} />
            </TableMat>
          )}
          {W > 0 && (
            <div style={at(r.side)}>
              <SidePanel />
            </div>
          )}
          {W > 0 && <Arrows rootRef={rootRef} />}
        </>
      )}
    </div>
  )
}

/** Discord's minimized Picture-in-Picture tile: unmistakable banner when it is your turn or priority, plus all players' life totals. */
function MiniStatus() {
  const game = useForge((s) => s.game)
  const players = useForge((s) => s.players)
  const prompt = useForge((s) => s.prompt?.message ?? '')
  const mine = useForge((s) => !!(s.buttons?.ok.enabled || s.buttons?.cancel.enabled || s.selectable.cardIds.size || s.selectable.playerIds?.size || s.ask))
  if (!game) return null
  const localIds = game.localPlayerIds
  const spectating = localIds.length === 0
  const activeId = game.activePlayerId
  const prioId = game.priorityPlayerId ?? activeId
  const active = activeId != null ? players[activeId] : undefined
  const prio = prioId != null ? players[prioId] : undefined
  const yourTurn = !spectating && activeId != null && localIds.includes(activeId)
  const yourMove = !spectating && (mine || (prioId != null && localIds.includes(prioId)))
  const step = stepWords(game.phase)
  const ids = game.turnOrder?.length ? game.turnOrder : Object.keys(players).map(Number).sort((a, b) => a - b)
  const headline = yourTurn
    ? 'YOUR TURN'
    : yourMove
      ? 'YOUR MOVE · RESPOND'
      : active
        ? `${active.name}'s turn`
        : 'In game'
  const sub = yourMove && prompt && !prompt.startsWith('Priority:')
    ? prompt
    : !yourMove && prio && prio.id !== activeId
      ? `Waiting on ${prio.name}`
      : `Turn ${game.turn}${step ? ` · ${step}` : ''}`
  return (
    <div
      className="lk-text"
      style={{
        position: 'absolute', inset: 0, padding: '10px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6, boxSizing: 'border-box',
        background: yourMove
          ? 'linear-gradient(180deg, rgb(66 50 18 / .96), rgb(20 15 9 / .98))'
          : 'linear-gradient(180deg, #1b1611, #0d0a07)',
        boxShadow: yourMove
          ? 'inset 0 0 0 2.5px var(--lk-gold), inset 0 0 28px rgb(245 213 138 / .22)'
          : 'inset 0 0 0 1.5px var(--lk-metal-line)',
        color: 'var(--lk-parchment)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span
            className={yourMove ? 'lk-breathe' : undefined}
            style={{
              width: 10, height: 10, borderRadius: 99, flex: 'none',
              background: yourMove ? 'var(--lk-gold)' : 'var(--lk-parchment-mute)',
              boxShadow: yourMove ? '0 0 10px var(--lk-gold)' : undefined,
            }}
          />
          <span
            className="lk-title"
            style={{
              fontWeight: 800, fontSize: 16, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.1,
              color: yourMove ? 'var(--lk-gold)' : 'var(--lk-parchment)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {headline}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: yourMove ? 'var(--lk-parchment)' : 'var(--lk-parchment-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5 }}>
        {ids.map((id) => {
          const p = players[id]
          if (!p) return null
          const isLocal = localIds.includes(p.id)
          const isTurn = p.id === activeId
          return (
            <div
              key={p.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 5, minWidth: 0,
                background: isTurn ? 'rgb(245 213 138 / .14)' : 'rgb(10 8 6 / .65)',
                boxShadow: `inset 0 0 0 1px ${isTurn ? 'var(--lk-gold)' : 'var(--lk-metal-line)'}`,
                opacity: p.hasLost ? 0.45 : 1,
              }}
            >
              <Face player={p} colors="C" size={20} />
              <span className="lk-title" style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, color: isLocal ? 'var(--lk-gold)' : 'var(--lk-parchment)' }}>
                {isLocal ? 'You' : p.name}
              </span>
              <span className="lk-title" style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', flex: 'none', color: 'var(--lk-parchment)' }}>
                {p.life}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScoreSpot({ meId, multi, x, seam, lineH, band }: { meId: number | null; multi: boolean; x: number; seam: number; lineH: number; band?: Region }) {
  const game = useForge((s) => s.game)!
  const players = useForge((s) => s.players)
  const net = useForge((s) => {
    const after = s.combatAssist?.players.find((p) => p.id === meId)?.lifeAfter
    const life = meId != null ? s.players[meId]?.life : undefined
    return after != null && life != null ? life - after : 0
  })
  const active = game.activePlayerId != null ? players[game.activePlayerId] : undefined
  const mine = game.activePlayerId === meId
  const ids = game.turnOrder?.length ? game.turnOrder : Object.keys(players).map(Number).sort((a, b) => a - b)
  const i = Math.max(0, ids.indexOf(game.activePlayerId ?? ids[0]))
  const order = multi ? [...ids.slice(i), ...ids.slice(0, i)].filter((id) => players[id]).map((id) => ({ id, name: players[id].name, you: id === meId, out: players[id].hasLost })) : undefined
  return (
    <div style={band
      ? { position: 'absolute', left: band.x, top: band.y + 6, width: band.w, zIndex: 20, pointerEvents: 'none' }
      : { position: 'absolute', left: x, top: mine ? seam + lineH + 10 : seam - 8, transform: mine ? undefined : 'translateY(-100%)', zIndex: 20, pointerEvents: 'none' }}>
      <Scoreboard name={active?.name ?? ''} you={mine} phase={game.phase} turn={game.turn} net={net > 0 ? net : undefined} order={order} activeId={game.activePlayerId ?? undefined} />
    </div>
  )
}
