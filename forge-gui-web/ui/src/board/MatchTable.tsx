import { useRef, type CSSProperties, type ReactNode } from 'react'
import type { Region } from '../table/contract'
import { CardLayer, useTableLayout } from '../table/CardLayer'
import { useForge } from '../store'
import { Arrows } from './Arrows'
import { CombatArena } from './CombatArena'
import { PhaseTracker, StackView } from './Center'
import { SidePanel } from './Preview'
import { OpponentStrip, SeatPanel } from './Seat'
import { useBoardUi } from './uiStore'
import { useSize } from './useSize'
import './board.css'

const at = (r: Region | undefined): CSSProperties => (r ? { position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h } : { display: 'none' })

// The whole table. The chrome is placed from the layout's regions; every card is drawn by the card layer.
// centerSlot is rendered in the middle strip, next to the stack (the shell puts the prompt bar there).
export function MatchTable({ centerSlot }: { centerSlot: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { W, H } = useSize(rootRef)
  const viewport = { w: W, h: H }
  const { layout, meId, focusId } = useTableLayout(viewport)
  const players = useForge((s) => s.players)
  const turn = useForge((s) => s.game?.turn ?? 0)
  const setFocus = useBoardUi((s) => s.setFocus)
  const me = meId != null ? players[meId] : undefined
  const opp = focusId != null ? players[focusId] : undefined
  const strips = Object.values(players)
    .filter((p) => p.id !== meId && p.id !== focusId)
    .sort((a, b) => a.id - b.id)
  const r = layout.regions

  return (
    <div ref={rootRef} className="relative h-full w-full select-none overflow-hidden bg-table text-ink" onContextMenu={(e) => e.preventDefault()}>
      {W > 0 && (
        <>
          {r.strips && (
            <div className="flex min-w-0 gap-2" style={at(r.strips)}>
              {strips.map((p) => (
                <OpponentStrip key={p.id} player={p} onFocus={() => setFocus(p.id, turn)} />
              ))}
            </div>
          )}
          <div style={at(r.oppSeat)}>{opp && <SeatPanel player={opp} isMe={false} compact={false} />}</div>
          <div className="felt rounded-2xl border border-line/70" style={at(r.top)} />
          <div className="felt rounded-2xl border border-line/70" style={at(r.bottom)} />
          <div className="pointer-events-none rounded-xl bg-table/35" style={at(r['top:back'])} />
          <div className="pointer-events-none rounded-xl bg-table/35" style={at(r['bottom:back'])} />
          <div className="rounded-xl border border-line/60 bg-panel/70" style={at(r.center)} />
          <div className="flex items-center overflow-hidden" style={at(r.phase)}>
            <PhaseTracker meId={meId} />
          </div>
          <div className="h-8 w-px bg-line" style={{ position: 'absolute', left: r.phase.x + r.phase.w + 16, top: r.center.y + 16 }} />
          <div style={at(r.stack)}>
            <StackView />
          </div>
          <div className="flex min-w-0 items-center justify-end" style={at(r.prompt)}>
            {centerSlot}
          </div>
          <div style={at(r.meSeat)}>{me && <SeatPanel player={me} isMe compact={false} />}</div>
          <div style={at(r.side)}>
            <SidePanel />
          </div>
          <CardLayer layout={layout} />
          <CombatArena meId={meId} right={r.side.w + 12} />
          <Arrows rootRef={rootRef} />
        </>
      )}
    </div>
  )
}
