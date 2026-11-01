import { Timeline } from './Timeline'

/** The right-hand column: the game's timeline. (Hovered cards now grow in place, D-09.) */
export function SidePanel() {
  return (
    <div className="lk-text flex h-full min-h-0 flex-col gap-2 px-4 py-4" style={{ background: 'linear-gradient(90deg, #120e0a, #0d0a07)', boxShadow: 'inset 1px 0 0 var(--lk-metal-line)', color: 'var(--lk-parchment)' }}>
      <Timeline />
    </div>
  )
}
