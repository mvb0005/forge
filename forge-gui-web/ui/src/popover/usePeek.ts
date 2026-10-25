import { useEffect, useMemo, useRef, type FocusEvent, type PointerEvent } from 'react'
import { peekKey, type PeekEntity } from '../table/peek'
import { peekTimer, usePopover, type PeekTarget } from './store'

export const PEEK_ID = 'forge-peek'

const target = (key: string, entity: PeekEntity, el: Element): PeekTarget => {
  const r = el.getBoundingClientRect()
  return { key, entity, anchor: { x: r.left, y: r.top, w: r.width, h: r.height } }
}

// Spread the result on any element to make it peekable. Focusability (tabIndex) is the caller's call.
export function usePeek(entity: PeekEntity) {
  const key = peekKey(entity)
  const ref = useRef(entity)
  useEffect(() => {
    ref.current = entity
  })
  const open = usePopover((s) => s.peek?.key === key)

  useEffect(() => () => peekTimer.leave(key), [key])

  const handlers = useMemo(
    () => ({
      onPointerEnter: (e: PointerEvent<Element>) => {
        if (e.pointerType !== 'touch') peekTimer.enter(key, target(key, ref.current, e.currentTarget))
      },
      onPointerLeave: () => peekTimer.leave(key),
      onFocus: (e: FocusEvent<Element>) => peekTimer.show(key, target(key, ref.current, e.currentTarget)),
      onBlur: () => peekTimer.leave(key),
    }),
    [key],
  )

  return { ...handlers, 'aria-describedby': open ? PEEK_ID : undefined }
}
