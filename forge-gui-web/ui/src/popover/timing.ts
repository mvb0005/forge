// Peek timing, independent of React and the DOM (docs/DESIGN.md "The four layers", D-09).
// Cold: the peek answer opens after INTENT_MS, the card grows after GROW_MS. Once a peek is open
// (or within the grace after leaving one) the table is warm: the next thing peeks at once and grows
// after WARM_GROW_MS. Leaving shrinks at once and closes the peek after GRACE_MS.

export const INTENT_MS = 120
export const GROW_MS = 300
export const WARM_GROW_MS = 150
export const GRACE_MS = 150

export type PeekOpen<T> = { key: string; value: T; grown: boolean }

export type PeekTimer<T> = {
  enter: (key: string, value: T) => void // pointer intent
  show: (key: string, value: T) => void // keyboard focus: peeks at once, grows after the warm dwell
  leave: (key: string) => void // ignored unless key is the pending or open one
  close: () => void // Esc: closes now and drops anything pending
  current: () => PeekOpen<T> | null
}

export function createPeekTimer<T>(
  onChange: (open: PeekOpen<T> | null) => void,
  { intentMs = INTENT_MS, growMs = GROW_MS, warmGrowMs = WARM_GROW_MS, graceMs = GRACE_MS } = {},
): PeekTimer<T> {
  let open: PeekOpen<T> | null = null
  let pendingKey: string | null = null
  let pending: ReturnType<typeof setTimeout> | undefined
  let grow: ReturnType<typeof setTimeout> | undefined
  let closing: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    clearTimeout(pending)
    clearTimeout(grow)
    clearTimeout(closing)
    pending = grow = closing = undefined
    pendingKey = null
  }
  const set = (next: PeekOpen<T> | null) => {
    open = next
    onChange(next)
  }
  const growLater = (key: string, ms: number) => {
    grow = setTimeout(() => {
      grow = undefined
      if (open?.key === key) set({ ...open, grown: true })
    }, ms)
  }
  const openNow = (key: string, value: T) => {
    clear()
    set({ key, value, grown: false })
    growLater(key, warmGrowMs)
  }

  return {
    enter(key, value) {
      if (open) {
        if (open.key === key && closing) {
          // back onto the same thing during the grace: keep the peek, grow again
          clearTimeout(closing)
          closing = undefined
          if (!grow && !open.grown) growLater(key, warmGrowMs)
        } else if (open.key !== key) openNow(key, value)
        return
      }
      if (pendingKey === key) return
      clear()
      pendingKey = key
      pending = setTimeout(() => {
        pendingKey = null
        set({ key, value, grown: false })
      }, intentMs)
      growLater(key, growMs)
    },
    show: openNow,
    leave(key) {
      if (pendingKey === key) clear()
      else if (open?.key === key && !closing) {
        clearTimeout(grow)
        grow = undefined
        if (open.grown) set({ ...open, grown: false })
        closing = setTimeout(() => {
          closing = undefined
          set(null)
        }, graceMs)
      }
    },
    close() {
      clear()
      if (open) set(null)
    },
    current: () => open,
  }
}
