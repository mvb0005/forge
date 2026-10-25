import { create } from 'zustand'
import type { PeekEntity } from '../table/peek'
import type { Rect } from './place'
import { createPeekTimer } from './timing'

export type PeekTarget = { key: string; entity: PeekEntity; anchor: Rect }

type PopoverState = {
  peek: PeekTarget | null
  grownCardId: number | null // the card layer draws this card grown in place (D-09)
  pinned: PeekTarget | null
}

export const usePopover = create<PopoverState>()(() => ({ peek: null, grownCardId: null, pinned: null }))

export const peekTimer = createPeekTimer<PeekTarget>((open) =>
  usePopover.setState({
    peek: open?.value ?? null,
    grownCardId: open?.grown && open.value.entity.kind === 'card' ? open.value.entity.id : null,
  }),
)

export const useGrown = (cardId: number) => usePopover((s) => s.grownCardId === cardId)

export function togglePin() {
  const { peek, pinned } = usePopover.getState()
  if (peek && peek.key !== pinned?.key) {
    usePopover.setState({ pinned: peek })
    peekTimer.close()
  } else if (pinned) usePopover.setState({ pinned: null })
}

// Esc: closes the peek first, then the pinned panel. Returns whether anything closed.
export function closeTop() {
  const { peek, pinned } = usePopover.getState()
  if (peek) peekTimer.close()
  else if (pinned) usePopover.setState({ pinned: null })
  return !!(peek || pinned)
}
