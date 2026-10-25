import type { PhaseName, StackItemDto } from '../protocol'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { Icon } from './icons'
import { STACK, stackItemX } from '../table/frame'
import { usePeek } from '../popover/usePeek'
import { useBoardUi } from './uiStore'

const PHASES: { label: string; phases: PhaseName[] }[] = [
  { label: 'Untap', phases: ['UNTAP'] },
  { label: 'Upkeep', phases: ['UPKEEP'] },
  { label: 'Draw', phases: ['DRAW'] },
  { label: 'Main 1', phases: ['MAIN1'] },
  { label: 'Combat', phases: ['COMBAT_BEGIN', 'COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'COMBAT_FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'COMBAT_END'] },
  { label: 'Main 2', phases: ['MAIN2'] },
  { label: 'End', phases: ['END_OF_TURN', 'CLEANUP'] },
]
const COMBAT_STEP: Partial<Record<PhaseName, string>> = {
  COMBAT_BEGIN: 'beginning of combat',
  COMBAT_DECLARE_ATTACKERS: 'declare attackers',
  COMBAT_DECLARE_BLOCKERS: 'declare blockers',
  COMBAT_FIRST_STRIKE_DAMAGE: 'first-strike damage',
  COMBAT_DAMAGE: 'combat damage',
  COMBAT_END: 'end of combat',
  CLEANUP: 'cleanup',
}

export function PhaseTracker({ meId }: { meId: number | null }) {
  const game = useForge((s) => s.game)
  const active = useForge((s) => (s.game?.activePlayerId != null ? s.players[s.game.activePlayerId] : undefined))
  const mine = game?.activePlayerId === meId
  const color = mine ? 'var(--color-accent)' : 'var(--color-danger)'
  const step = game?.phase ? COMBAT_STEP[game.phase] : undefined
  return (
    <div className="flex min-w-0 flex-col justify-center gap-1">
      <div className="flex items-baseline gap-2 text-[11px] text-ink-dim">
        <span className="font-bold uppercase tracking-wider text-ink">Turn {game?.turn ?? 0}</span>
        <span className="truncate" style={{ color }}>
          {mine ? 'Your turn' : active ? `${active.name}'s turn` : ''}
        </span>
        {step && <span className="truncate">· {step}</span>}
      </div>
      <div className="flex gap-0.5">
        {PHASES.map((p) => {
          const on = !!game?.phase && p.phases.includes(game.phase)
          return (
            <span
              key={p.label}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap transition duration-150 ${on ? 'text-table' : 'text-ink-dim/80'}`}
              style={on ? { background: color } : { background: 'color-mix(in oklab, var(--color-panel-2) 60%, transparent)' }}
            >
              {p.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** The stack, top first (leftmost). Hover an item to see its source and targets. */
export function StackView() {
  const stack = useForge((s) => s.stack)
  if (!stack.length) return null
  return (
    <div className="relative h-full">
      <span className="absolute left-0 top-1/2 w-3.5 -translate-y-1/2 rotate-180 text-[10px] font-bold uppercase tracking-wider text-ink-dim [writing-mode:vertical-rl]">Stack</span>
      {stack.slice(0, STACK.shown).map((item, i) => (
        <StackItem key={item.id} item={item} top={i === 0} x={stackItemX(i)} />
      ))}
      {stack.length > STACK.shown && (
        <span className="absolute top-1/2 -translate-y-1/2 text-xs text-ink-dim" style={{ left: stackItemX(STACK.shown - 1) + STACK.rest + 6 }}>
          +{stack.length - STACK.shown}
        </span>
      )}
    </div>
  )
}

// Spells on the stack draw their own card in the thumbnail slot (card layer); abilities show their source.
function StackItem({ item, top, x }: { item: StackItemDto; top: boolean; x: number }) {
  const source = useForge((s) => (item.sourceCardId != null ? s.cards[item.sourceCardId] : undefined))
  const own = source?.zone === 'stack'
  const peek = usePeek({ kind: 'card', id: item.sourceCardId ?? -1 })
  const activator = useForge((s) => (item.activatorId != null ? s.players[item.activatorId] : undefined))
  const hovered = useBoardUi((s) => s.hoverStackId === item.id)
  const setHoverStack = useBoardUi((s) => s.setHoverStack)
  const kind = item.isTrigger ? 'Trigger' : item.isAbility ? 'Ability' : 'Spell'
  return (
    <div
      data-entity={`stack:${item.id}`}
      className={`absolute flex items-center gap-2 rounded-lg border bg-panel px-1.5 transition duration-150 ${
        hovered ? 'border-accent bg-panel-2' : top ? 'border-line' : 'border-line/60 opacity-80'
      }`}
      style={{ left: x, top: STACK.itemY, height: STACK.itemH, width: top ? STACK.top : STACK.rest }}
      onMouseEnter={() => {
        setHoverStack(item.id)
      }}
      onMouseLeave={() => {
        setHoverStack(null)
      }}
    >
      <div className="shrink-0 overflow-hidden rounded-[4px]" style={{ width: 32, height: 44 }} {...(source && !own ? peek : {})}>
        {own ? null : source ? <CardImage card={source} width={32} bare /> : <div className="h-full w-full bg-panel-2" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[11px]">
          <span className={`inline-flex items-center gap-0.5 font-bold uppercase tracking-wide ${item.isTrigger ? 'text-target' : item.isAbility ? 'text-accent' : 'text-playable'}`}>
            {item.isTrigger ? Icon.bolt(10) : null}
            {kind}
          </span>
          <span className="truncate font-semibold text-ink">{source?.name ?? ''}</span>
          {top && <span className="ml-auto shrink-0 rounded bg-ink/10 px-1 text-[9px] font-bold uppercase text-ink-dim">top</span>}
        </div>
        <div className="line-clamp-2 text-[11px] leading-tight text-ink-dim" title={`${activator?.name ?? ''}: ${item.text}`}>
          {item.text}
        </div>
      </div>
    </div>
  )
}
