import { useEffect, useState, type ReactNode } from 'react'
import type { CardDto, PhaseName } from '../protocol'
import { useForge } from '../store'
import type { PeekEntity } from '../table/peek'
import { ATTACKERS, HIDDEN, ME, MINE, OPP, PHASES, peekFixture } from './fixtures'
import { grownRect } from './place'
import { PeekRoot } from './PeekRoot'
import { usePopover } from './store'
import { usePeek } from './usePeek'

// /?peek: peekable fixture cards, lanes and players, no server. Tab through them for keyboard peeks.
export function DevPeek() {
  const [phase, setPhase] = useState<PhaseName>('COMBAT_DECLARE_BLOCKERS')
  useEffect(() => {
    useForge.setState({ connected: false, ask: null, reveal: null, notices: [], gameOver: null, ...peekFixture(phase) })
  }, [phase])
  const cards = useForge((s) => s.cards)
  const players = useForge((s) => s.players)
  if (!cards[ATTACKERS[0]]) return null

  return (
    <div className="fixed inset-0 flex flex-col gap-4 bg-felt p-4">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-accent">Peek fixtures</span>
        {PHASES.map((p) => (
          <button key={p} type="button" onClick={() => setPhase(p)}
            className={`rounded-md px-2 py-1 ${p === phase ? 'bg-accent text-table' : 'bg-panel text-ink-dim hover:text-ink'}`}>{p}</button>
        ))}
        <span className="ml-auto text-ink-dim">Hover or Tab: peek at 120 ms, card grows at 300 ms · I pins · Esc closes</span>
      </div>

      <Peekable entity={{ kind: 'player', id: OPP }} className="self-center rounded-lg bg-panel px-4 py-2">
        {players[OPP].name} · {players[OPP].life} life
      </Peekable>
      <div className="flex justify-center gap-3">
        {ATTACKERS.map((id) => <CardBox key={id} card={cards[id]} />)}
        <CardBox card={cards[HIDDEN]} />
      </div>

      <div className="flex justify-center gap-3">
        {ATTACKERS.map((id) => (
          <Peekable key={id} entity={{ kind: 'lane', attackerId: id }} className="w-32 rounded-lg border border-dashed border-line px-2 py-3 text-center text-xs text-ink-dim">
            lane: {cards[id].name}
          </Peekable>
        ))}
      </div>

      <div className="mt-auto flex justify-between">
        <CardBox card={cards[MINE[0]]} />
        <div className="flex gap-3">{MINE.slice(1, 3).map((id) => <CardBox key={id} card={cards[id]} />)}</div>
        <CardBox card={cards[MINE[3]]} />
      </div>
      <Peekable entity={{ kind: 'player', id: ME }} className="self-center rounded-lg bg-panel px-4 py-2">
        {players[ME].name} · {players[ME].life} life
      </Peekable>
      <Grown />
      <PeekRoot />
    </div>
  )
}

function Peekable({ entity, className, children }: { entity: PeekEntity; className: string; children: ReactNode }) {
  return <button type="button" {...usePeek(entity)} className={`${className} focus:outline-2 focus:outline-accent`}>{children}</button>
}

function CardBox({ card }: { card: CardDto }) {
  return (
    <Peekable entity={{ kind: 'card', id: card.id }} className="flex h-[134px] w-24 flex-col rounded-lg border border-line bg-panel-2 p-1.5 text-left">
      <CardFace card={card} />
    </Peekable>
  )
}

function CardFace({ card, big = false }: { card: CardDto; big?: boolean }) {
  if (card.hidden) return <div className="m-auto text-xs text-ink-dim">hidden</div>
  return (
    <>
      <div className={`font-semibold leading-tight ${big ? 'text-base' : 'text-[11px]'}`}>{card.name}</div>
      <div className={`text-ink-dim ${big ? 'text-xs' : 'text-[9px]'}`}>{card.typeLine}</div>
      {big && <p className="mt-2 whitespace-pre-line text-sm">{card.text}</p>}
      <div className={`mt-auto self-end font-semibold ${big ? 'text-lg' : 'text-xs'}`}>
        {card.tapped && <span className="mr-1 text-ink-dim">tapped</span>}
        {card.power != null && `${card.power}/${card.toughness}`}
      </div>
    </>
  )
}

// Stand-in for the card layer's growth: the grown card drawn over its neighbours, pointer-transparent
// so leaving the original footprint shrinks it and the neighbours stay hoverable.
function Grown() {
  const id = usePopover((s) => s.grownCardId)
  const anchor = usePopover((s) => s.peek?.anchor)
  const card = useForge((s) => (id != null ? s.cards[id] : undefined))
  if (!card || !anchor) return null
  const r = grownRect(anchor, { w: window.innerWidth, h: window.innerHeight })
  return (
    <div className="pointer-events-none fixed z-[70] flex flex-col rounded-xl border border-accent/50 bg-panel-2 p-3 shadow-2xl"
      style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
      <CardFace card={card} big />
    </div>
  )
}
