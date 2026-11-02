import { TimelineFooter } from './Callouts'
import { StackPanel } from './Center'
import { Timeline } from './Timeline'

/** The right-hand column: the game's timeline, the stack under it, and the priority/card panel at the bottom. */
export function SidePanel() {
  return (
    <div className="lk-text flex h-full min-h-0 flex-col gap-2 px-4 py-4" style={{ background: 'linear-gradient(90deg, #120e0a, #0d0a07)', boxShadow: 'inset 1px 0 0 var(--lk-metal-line)', color: 'var(--lk-parchment)' }}>
      <Timeline />
      <StackPanel />
      <TimelineFooter />
    </div>
  )
}
