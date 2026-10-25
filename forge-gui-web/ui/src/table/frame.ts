import type { Region } from './contract'

// The table's chrome rectangles for a viewport: seats, the two battlefield halves, the centre
// strip (phase, stack, prompt), the hand and the side panel. Pure, so the card layout and the chrome
// agree on every pixel without measuring the DOM.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

const GAP = 8
export const CENTER_H = 64
export const STRIP_H = 52
export const PHASE_W = 350

// Stack items in the centre strip: the top item is wider. Spells show their own card (from the
// card layer) in the thumbnail slot; StackView draws the rest of the item around it.
export const STACK = { label: 20, gap: 6, top: 250, rest: 190, shown: 4, itemY: 6, itemH: 52, thumbX: 7, thumbY: 4, thumbW: 32, more: 30 }

export const stackItemX = (i: number) => STACK.label + (i > 0 ? STACK.top + STACK.gap + (i - 1) * (STACK.rest + STACK.gap) : 0)

export function stackWidth(n: number) {
  if (!n) return 0
  const shown = Math.min(n, STACK.shown)
  return stackItemX(shown - 1) + (shown === 1 ? STACK.top : STACK.rest) + (n > STACK.shown ? STACK.more : 0)
}

export type Frame = {
  side: Region // right column (log)
  strips: Region | null // multiplayer: unfocused opponents
  oppSeat: Region
  top: Region // opponent's battlefield half
  center: Region
  phase: Region
  stack: Region
  prompt: Region
  meSeat: Region
  bottom: Region // your battlefield half
  hand: Region
}

export function tableFrame(view: { w: number; h: number }, strips: boolean, stackLen: number): Frame {
  const sideW = clamp(view.w * 0.17, 230, 330)
  const leftW = Math.max(200, view.w - sideW)
  const seatW = clamp(view.w * 0.115, 168, 215)
  const handH = clamp(view.h * 0.155, 104, 172)
  const x0 = GAP
  const innerW = leftW - 2 * GAP
  const feltX = x0 + seatW + GAP
  const feltW = Math.max(50, innerW - seatW - GAP)
  let y = GAP
  const stripR = strips ? { x: x0, y, w: innerW, h: STRIP_H } : null
  if (strips) y += STRIP_H + GAP
  const half = Math.max(60, (view.h - y - CENTER_H - handH - 3 * GAP) / 2)
  const top = { x: feltX, y, w: feltW, h: half }
  const center = { x: x0, y: y + half + GAP, w: innerW, h: CENTER_H }
  const bottom = { x: feltX, y: center.y + CENTER_H + GAP, w: feltW, h: half }
  const hand = { x: feltX, y: bottom.y + half + GAP, w: feltW, h: handH }
  const phase = { x: center.x + 12, y: center.y, w: PHASE_W, h: CENTER_H }
  const stack = { x: phase.x + PHASE_W + 33, y: center.y, w: stackWidth(stackLen), h: CENTER_H }
  const promptX = stack.x + stack.w + 16
  return {
    side: { x: leftW, y: 0, w: view.w - leftW, h: view.h },
    strips: stripR,
    oppSeat: { x: x0, y, w: seatW, h: half },
    top,
    center,
    phase,
    stack,
    prompt: { x: promptX, y: center.y, w: Math.max(0, center.x + center.w - 12 - promptX), h: CENTER_H },
    meSeat: { x: x0, y: bottom.y, w: seatW, h: hand.y + handH - bottom.y - GAP },
    bottom,
    hand,
  }
}
