import { useRef, type CSSProperties, type ReactNode } from 'react'
import { isCombat } from '../look/phase'
import { TableHalf, TableMat } from '../look/TableHalf'
import { TypeLine } from '../look/TypeLine'
import { usePromptHint } from '../shell/PromptBar'
import type { Region } from '../table/contract'
import { CardLayer, useTableLayout } from '../table/CardLayer'
import { useForge } from '../store'
import { Arrows } from './Arrows'
import { BlockSlots } from './CombatArena'
import { StackView } from './Center'
import { SidePanel } from './Preview'
import { Piles, Ribbon, SeatPlate, StripSeat, useSeatColors } from './Seat'
import { useBoardUi } from './uiStore'
import { useSize } from './useSize'
import './board.css'

const at = (r: Region | undefined): CSSProperties => (r ? { position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h } : { display: 'none' })
const MOVE: CSSProperties = { transition: 'transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1)' }

function ColumnMat({ playerId, region, turn }: { playerId: number; region: Region; turn: number }) {
  const player = useForge((s) => s.players[playerId])
  const colors = useSeatColors(player)
  const active = useForge((s) => s.game?.activePlayerId === playerId)
  const setFocus = useBoardUi((s) => s.setFocus)
  return (
    <div onClick={() => setFocus(playerId, turn)} style={{ position: 'absolute', left: region.x, top: region.y, width: region.w, height: region.h, cursor: 'pointer' }}>
      <TableHalf colors={colors} active={active} side="top" style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

function ColumnSeat({ playerId, seat, ribbon, turn }: { playerId: number; seat: Region; ribbon: Region; turn: number }) {
  const player = useForge((s) => s.players[playerId])
  const setFocus = useBoardUi((s) => s.setFocus)
  if (!player) return null
  return (
    <>
      <div onClick={() => setFocus(playerId, turn)} style={{ ...at(seat), zIndex: 8, display: 'flex', alignItems: 'center', padding: '0 8px', boxSizing: 'border-box', cursor: 'pointer' }}>
        <SeatPlate player={player} isMe={false} compact />
      </div>
      <Ribbon player={player} isMe={false} style={{ ...at(ribbon), display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3, overflow: 'hidden' }} />
    </>
  )
}

// The whole table in the look (docs/DESIGN.md): two coloured halves, the type line between them (it
// rises in combat), seats, ribbons, the action column and the log. The chrome is placed from the
// layout's regions; every card is drawn by the card layer. centerSlot is the action plate.
export function MatchTable({ centerSlot }: { centerSlot: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { W, H } = useSize(rootRef)
  const viewport = { w: W, h: H }
  const { layout, meId, focusId } = useTableLayout(viewport)
  const players = useForge((s) => s.players)
  const game = useForge((s) => s.game)
  const turn = game?.turn ?? 0
  const setFocus = useBoardUi((s) => s.setFocus)
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
    .sort((a, b) => a.half.x - b.half.x)
  const band = r.split && r.top && r.bottom && isCombat(game?.phase ?? null) && Object.keys(r).some((k) => k.startsWith('lane:'))

  const halves = r.split && (
    <>
      {columns.length > 0 ? (
        columns.map((c) => <ColumnMat key={c.id} playerId={c.id} region={c.half} turn={turn} />)
      ) : (
        <TableHalf colors={oppColors} active={activeId != null && activeId === focusId} side="top" style={{ position: 'absolute', left: 0, top: 0, width: r.split.w, height: r.split.y }} />
      )}
      <TableHalf colors={meColors} active={activeId === meId} side="bottom" style={{ position: 'absolute', left: 0, top: r.split.y, width: r.split.w, height: H - r.split.y }} />
    </>
  )

  return (
    <div ref={rootRef} className="relative h-full w-full select-none overflow-hidden" style={{ background: 'var(--lk-ink)' }} onContextMenu={(e) => e.preventDefault()}>
      {W > 0 && r.split && (
        <TableMat halves={halves} style={{ position: 'absolute', left: 0, top: 0, width: r.split.w, height: H }}>
          {band && (
            <div className="pointer-events-none" style={{ position: 'absolute', left: 0, right: 0, top: r.top.y - 20, height: r.bottom.y + r.bottom.h - r.top.y + 40, background: 'linear-gradient(rgb(255 106 61 / 0), rgb(255 106 61 / .1) 50%, rgb(255 106 61 / 0))' }} />
          )}
          {r.strips && (
            <div style={{ ...at(r.strips), display: 'flex', gap: 12, zIndex: 7 }}>
              {strips.map((p) => (
                <StripSeat key={p.id} player={p} width={Math.min(460, (r.strips.w - 12 * (strips.length - 1)) / Math.max(1, strips.length))} onFocus={() => setFocus(p.id, turn)} />
              ))}
            </div>
          )}
          {columns.length === 0 && opp && (
            <div style={{ position: 'absolute', left: r.oppSeat.x + 12, top: 0, zIndex: 8, transform: `translateY(${r.oppSeat.y + 10}px)`, ...MOVE }}>
              <SeatPlate player={opp} isMe={false} />
            </div>
          )}
          {columns.length === 0 && opp && <Ribbon player={opp} isMe={false} style={{ ...at(r.oppRibbon), display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3 }} />}
          {columns.map((c) => c.seat && c.ribbon && <ColumnSeat key={c.id} playerId={c.id} seat={c.seat} ribbon={c.ribbon} turn={turn} />)}
          {me && <Ribbon player={me} isMe style={{ ...at(r.meRibbon), display: 'flex', alignItems: 'center', zIndex: 3 }} />}
          {game && (
            <div style={{ position: 'absolute', left: r.line.x, top: 0, width: r.line.w, zIndex: 20, transform: `translateY(${r.line.y + (r.line.h - 48) / 2}px)`, ...MOVE }}>
              <Line meId={meId} multi={Object.keys(players).length > 2} />
            </div>
          )}
          <div style={{ ...at(r.stack), zIndex: 9 }}>
            <StackView h={r.stack.h} />
          </div>
          <div style={{ position: 'absolute', left: r.act.x, top: 0, width: r.act.w, zIndex: 22, transform: `translateY(${r.act.y}px)`, ...MOVE }}>
            {centerSlot}
          </div>
          {me && (
            <div style={{ position: 'absolute', left: r.meSeat.x + 12, top: r.meSeat.y + 4, zIndex: 8 }}>
              <SeatPlate player={me} isMe />
            </div>
          )}
          {me && (
            <div style={{ ...at(r.piles), zIndex: 8, display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', padding: '0 10px 14px 0', boxSizing: 'border-box' }}>
              <Piles player={me} />
            </div>
          )}
          <BlockSlots layout={layout} />
          <CardLayer layout={layout} />
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

function Line({ meId, multi }: { meId: number | null; multi: boolean }) {
  const game = useForge((s) => s.game)!
  const players = useForge((s) => s.players)
  const hint = usePromptHint()
  const net = useForge((s) => {
    const after = s.combatAssist?.players.find((p) => p.id === meId)?.lifeAfter
    const life = meId != null ? s.players[meId]?.life : undefined
    return after != null && life != null ? life - after : 0
  })
  const active = game.activePlayerId != null ? players[game.activePlayerId] : undefined
  const ids = game.turnOrder?.length ? game.turnOrder : Object.keys(players).map(Number).sort((a, b) => a - b)
  const i = Math.max(0, ids.indexOf(game.activePlayerId ?? ids[0]))
  const order = multi ? [...ids.slice(i), ...ids.slice(0, i)].filter((id) => players[id]).map((id) => ({ id, name: players[id].name, you: id === meId, out: players[id].hasLost })) : undefined
  return (
    <TypeLine
      activeName={active?.name ?? ''}
      you={game.activePlayerId === meId}
      phase={game.phase}
      turn={game.turn}
      hint={hint}
      ledger={net > 0 ? `Net −${net}` : undefined}
      order={order}
      activeId={game.activePlayerId ?? undefined}
      gemLabels={!multi}
    />
  )
}
