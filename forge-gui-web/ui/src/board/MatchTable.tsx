import { useMemo, useRef, type ReactNode } from 'react'
import type { CardDto, PlayerDto } from '../protocol'
import { useForge } from '../store'
import { Arrows } from './Arrows'
import { CombatArena } from './CombatArena'
import { Battlefield, layoutTable } from './Battlefield'
import { PhaseTracker, StackView } from './Center'
import { Hand } from './Hand'
import { chooseFocus } from './layout'
import { PreviewPanel } from './Preview'
import { OpponentStrip, SeatPanel } from './Seat'
import { useBoardUi } from './uiStore'
import { useSize } from './useSize'
import './board.css'

const EMPTY: PlayerDto[] = []

// The whole table (seats, battlefields, hand, stack, card preview).
// centerSlot is rendered in the middle strip, next to the stack (the shell puts the prompt bar there).
export function MatchTable({ centerSlot }: { centerSlot: ReactNode }) {
  const game = useForge((s) => s.game)
  const playersMap = useForge((s) => s.players)
  const cards = useForge((s) => s.cards)
  const combat = useForge((s) => s.combat)
  const highlighted = useForge((s) => s.highlighted)
  const userFocus = useBoardUi((s) => s.focus)
  const setFocus = useBoardUi((s) => s.setFocus)

  const players = useMemo(() => (Object.keys(playersMap).length ? Object.values(playersMap).sort((a, b) => a.id - b.id) : EMPTY), [playersMap])
  const meId = game?.localPlayerIds[0] ?? players[0]?.id ?? null
  const me = meId != null ? playersMap[meId] : undefined
  const opps = players.filter((p) => p.id !== meId)
  const autoFocus = meId != null ? chooseFocus(players, meId, game, combat, cards) : null
  const focusId =
    userFocus && userFocus.turn === game?.turn && opps.some((p) => p.id === userFocus.playerId) ? userFocus.playerId : (autoFocus ?? opps[0]?.id ?? null)
  const opp = focusId != null ? playersMap[focusId] : undefined
  const strips = opps.length > 1 ? opps.filter((p) => p.id !== focusId) : []

  const rootRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const botRef = useRef<HTMLDivElement>(null)
  const topSize = useSize(topRef)
  const botSize = useSize(botRef)

  const layout = useMemo(() => {
    const list = (p?: PlayerDto) => (p ? p.zones.battlefield.map((id) => cards[id]).filter((c): c is CardDto => !!c) : [])
    const topCards = list(opp)
    const botCards = list(me)
    const shown = new Set([...topCards, ...botCards].map((c) => c.id))
    const size = { W: Math.min(topSize.W, botSize.W), H: Math.min(topSize.H, botSize.H) }
    const maxW = Math.min(176, Math.max(90, size.W / 7))
    return layoutTable(topCards, botCards, combat, highlighted, (id) => shown.has(id), size, maxW)
  }, [opp, me, cards, combat, highlighted, topSize, botSize])

  const hand = useMemo(() => (me ? me.zones.hand.map((id) => cards[id]).filter((c): c is CardDto => !!c) : []), [me, cards])

  return (
    <div
      ref={rootRef}
      className="relative grid h-full w-full select-none overflow-hidden bg-table text-ink"
      style={{ gridTemplateColumns: 'minmax(0,1fr) clamp(230px, 17vw, 330px)' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="grid min-h-0 min-w-0 gap-2 p-2 pb-0"
        style={{
          gridTemplateColumns: 'clamp(168px, 11.5vw, 215px) minmax(0,1fr)',
          gridTemplateRows: `${strips.length ? '52px ' : ''}minmax(0,1fr) 64px minmax(0,1fr) clamp(104px, 15.5vh, 172px)`,
        }}
      >
        {strips.length > 0 && (
          <div className="col-span-2 flex min-w-0 gap-2">
            {strips.map((p) => (
              <OpponentStrip key={p.id} player={p} cards={cards} onFocus={() => setFocus(p.id, game?.turn ?? 0)} />
            ))}
          </div>
        )}

        <div className="relative min-h-0">{opp && <SeatPanel player={opp} isMe={false} compact={false} />}</div>
        <div className="felt relative min-h-0 rounded-2xl border border-line/70">
          <div ref={topRef} className="absolute inset-0">
            <Battlefield layout={layout.top} side="top" />
          </div>
        </div>

        <div className="col-span-2 flex min-w-0 items-center gap-4 rounded-xl border border-line/60 bg-panel/70 px-3">
          <PhaseTracker meId={meId} />
          <div className="h-8 w-px shrink-0 bg-line" />
          <StackView />
          <div className="flex min-w-0 flex-1 items-center justify-end">{centerSlot}</div>
        </div>

        <div className="relative row-span-2 min-h-0 pb-2">{me && <SeatPanel player={me} isMe compact={false} />}</div>
        <div className="felt relative min-h-0 rounded-2xl border border-line/70">
          <div ref={botRef} className="absolute inset-0">
            <Battlefield layout={layout.bottom} side="bottom" />
          </div>
        </div>
        <div className="relative z-20 min-h-0 min-w-0">
          <Hand cards={hand} />
        </div>
      </div>
      <PreviewPanel />
      <CombatArena meId={meId} />
      <Arrows rootRef={rootRef} layoutVersion={layout} />
    </div>
  )
}
