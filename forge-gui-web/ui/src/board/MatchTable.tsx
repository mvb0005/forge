import { useRef, type CSSProperties, type ReactNode } from 'react'
import { TableHalf, TableMat } from '../look/TableHalf'
import { PromptHeadline } from '../shell/PromptBar'
import type { Region } from '../table/contract'
import { ACT_BUTTONS_H } from '../table/frame'
import { CardLayer, useTableLayout } from '../table/CardLayer'
import { useForge } from '../store'
import { Arrows } from './Arrows'
import { Arena } from './Arena'
import { BlockSlots } from './CombatArena'
import { Scoreboard } from './Scoreboard'
import { StackView } from './Center'
import { SidePanel } from './Preview'
import { Callouts } from './Callouts'
import { CommandSlots, Piles, PlayerBorder, Ribbon, SeatPlate, StripSeat, useSeatColors } from './Seat'
import { useBoardUi } from './uiStore'
import { useSize } from './useSize'
import './board.css'

// A seat or pile whose zone viewer is open comes above the card layer (z 10) and the control panel (22):
// the viewer's own z-index only counts inside its wrapper.
const RAISED = 40

const at = (r: Region | undefined): CSSProperties => (r ? { position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h } : { display: 'none' })

function ColumnMat({ playerId, region, turn, extend }: { playerId: number; region: Region; turn: number; extend?: boolean }) {
  const player = useForge((s) => s.players[playerId])
  const colors = useSeatColors(player)
  const active = useForge((s) => s.game?.activePlayerId === playerId)
  const setFocus = useBoardUi((s) => s.setFocus)
  return (
    <div onClick={() => setFocus(playerId, turn)} style={{ position: 'absolute', left: region.x, top: region.y, width: region.w, height: extend ? `calc(100% - ${region.y}px)` : region.h, cursor: 'pointer' }}>
      <TableHalf colors={colors} active={active} side={extend ? 'bottom' : 'top'} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

function ColumnSeat({ playerId, seat, ribbon, turn, isMe, regions }: { playerId: number; seat: Region; ribbon: Region; turn: number; isMe: boolean; regions: Record<string, Region> }) {
  const player = useForge((s) => s.players[playerId])
  if (!player) return null
  const slot = player.commanders?.length ? regions[`command:${player.commanders[0].cardId}`] : undefined
  const cmdW = slot ? seat.x + seat.w - slot.x : 0
  return (
    <>
      <PlayerBorder player={player} isMe={isMe} region={seat} cmdW={cmdW} turn={turn} />
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
          <div style={{ ...at(r.stack), zIndex: 9 }}>
            <StackView h={r.stack.h} />
          </div>
          <div style={{ ...at(r.act), zIndex: 22, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10 }}>
            {!columns.length && <PromptHeadline />}
            <div style={{ height: ACT_BUTTONS_H, flex: 'none' }}>{centerSlot}</div>
          </div>
          {me && !meIsBand && (
            <div style={{ position: 'absolute', left: r.meSeat.x + 12, top: r.meSeat.y + 4, zIndex: raise(me.id) }}>
              <SeatPlate player={me} isMe />
            </div>
          )}
          {me && (
            <div style={{ ...at(r.piles), zIndex: raise(me.id), display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', padding: '0 10px 14px 0', boxSizing: 'border-box' }}>
              <Piles player={me} />
            </div>
          )}
          <BlockSlots layout={layout} />
          <CommandSlots regions={r} />
          <CardLayer layout={layout} />
          {columns.length > 0 && <Callouts regions={r} />}
        </TableMat>
      )}
      {W > 0 && (
        <div style={at(r.side)}>
          <SidePanel />
        </div>
      )}
      {W > 0 && <Arrows rootRef={rootRef} />}
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
