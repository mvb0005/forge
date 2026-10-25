export type Rect = { x: number; y: number; w: number; h: number }
export type Side = 'left' | 'right' | 'top' | 'bottom'
type Size = { w: number; h: number }

export const GROWN_W = 250 // a hovered card grows to this width (D-09), height by the card ratio
const CARD_RATIO = 88 / 63

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const fit = (size: Size, view: Size, m: number) => ({ w: Math.min(size.w, view.w - 2 * m), h: Math.min(size.h, view.h - 2 * m) })

// Where a hovered card grows to: same centre, GROWN_W wide (never smaller than it is), kept on screen.
export function grownRect(card: Rect, view: Size, m = 8): Rect {
  const w = Math.max(card.w, GROWN_W)
  const { w: gw, h: gh } = fit({ w, h: w * CARD_RATIO }, view, m)
  return {
    x: clamp(card.x + card.w / 2 - gw / 2, m, view.w - m - gw),
    y: clamp(card.y + card.h / 2 - gh / 2, m, view.h - m - gh),
    w: gw,
    h: gh,
  }
}

// The peek answer: right beside the target (pass the grown card's rect for a card), on the side
// with more room, top-aligned with it; above/below when neither side fits. Clamped to the viewport.
export function placeBeside(target: Rect, size: Size, view: Size, gap = 8, m = 12): Rect & { side: Side } {
  const { w, h } = fit(size, view, m)
  const roomL = target.x - gap - m
  const roomR = view.w - m - (target.x + target.w + gap)
  if (Math.max(roomL, roomR) >= w) {
    const side: Side = roomR >= roomL ? 'right' : 'left'
    return { side, x: side === 'right' ? target.x + target.w + gap : target.x - gap - w, y: clamp(target.y, m, view.h - m - h), w, h }
  }
  const roomT = target.y - gap - m
  const roomB = view.h - m - (target.y + target.h + gap)
  const side: Side = roomB >= roomT ? 'bottom' : 'top'
  return {
    side,
    x: clamp(target.x + target.w / 2 - w / 2, m, view.w - m - w),
    y: clamp(side === 'bottom' ? target.y + target.h + gap : target.y - gap - h, m, view.h - m - h),
    w,
    h,
  }
}

// The pinned Inspect panel: against the viewport edge on the far side from the target, so it stays
// out of the way while you keep playing; the opposite left/right edge first, else top/bottom,
// else whichever covers less of the target.
export function placeFar(target: Rect, size: Size, view: Size, m = 12): Rect & { side: Side } {
  const { w, h } = fit(size, view, m)
  const cx = target.x + target.w / 2
  const cy = target.y + target.h / 2
  const xSide: Side = cx < view.w / 2 ? 'right' : 'left'
  const ySide: Side = cy < view.h / 2 ? 'bottom' : 'top'
  const across = { side: xSide, x: xSide === 'right' ? view.w - m - w : m, y: clamp(cy - h / 2, m, view.h - m - h), w, h }
  const covered = overlap(across, target)
  if (!covered) return across
  const vertical = { side: ySide, x: clamp(cx - w / 2, m, view.w - m - w), y: ySide === 'bottom' ? view.h - m - h : m, w, h }
  return overlap(vertical, target) < covered ? vertical : across
}
