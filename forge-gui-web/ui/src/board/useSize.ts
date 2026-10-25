import { useLayoutEffect, useState, type RefObject } from 'react'

/** Content-box size of an element, kept current with a ResizeObserver. */
export function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ W: 0, H: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const W = Math.round(e.contentRect.width)
      const H = Math.round(e.contentRect.height)
      setSize((s) => (s.W === W && s.H === H ? s : { W, H }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}
