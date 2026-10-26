import type { Region } from './contract'

// The table's chrome rectangles for a viewport: the two battlefield halves, the type line between
// them (it rises above the opponent's half in combat), the seats, mana ribbons, the action column
// (stack, action plate, piles), the hand and the log. Pure, so the card layout and the chrome agree
// on every pixel without measuring the DOM.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

const GAP = 8
const EDGE = 18 // inside the mat's rim
export const LINE_H = 64
export const STRIP_H = 104
export const RIBBON_H = 46
export const COL_HEAD = 64 // compact life and name above each opponent column on your turn

// Stack items in the action column, top of the stack nearest the type line. Spells show their own
// card (from the card layer) in the thumbnail slot; StackView draws the rest of the item around it.
export const STACK = { gap: 6, shown: 4, itemH: 56, thumbX: 7, thumbY: 5, thumbW: 33, more: 22 }

/** Offset of stack item i (0 = top of the stack) from the bottom of the stack region. */
export const stackItemY = (i: number) => (i + 1) * STACK.itemH + i * STACK.gap

export function stackHeight(n: number) {
  if (!n) return 0
  return stackItemY(Math.min(n, STACK.shown) - 1) + (n > STACK.shown ? STACK.more : 0)
}

export type Frame = {
  side: Region // right column (log)
  strips: Region | null // multiplayer: unfocused opponents
  oppSeat: Region // focused opponent's shield and name
  oppRibbon: Region
  top: Region // opponent's battlefield (cards)
  line: Region // the type line
  stack: Region
  act: Region // the action plate
  meSeat: Region
  meRibbon: Region
  bottom: Region // your battlefield (cards)
  hand: Region
  piles: Region // your library, graveyard, exile, command
  split: Region // y where the two coloured halves meet (h = 0)
}

export function tableFrame(view: { w: number; h: number }, strips: boolean, stackLen: number, combat = false, fanout = false): Frame {
  const sideW = clamp(view.w * 0.15, 220, 300)
  const leftW = Math.max(400, view.w - sideW)
  const seatW = clamp(view.w * 0.1, 150, 210)
  const actW = clamp(view.w * 0.14, 220, 300)
  const handH = clamp(view.h * 0.15, 100, 168)
  const x0 = EDGE
  const innerW = leftW - EDGE - GAP
  const feltX = x0 + seatW + GAP
  const feltW = Math.max(60, innerW - seatW - actW - 2 * GAP)
  const actX = feltX + feltW + GAP
  let y = EDGE
  const stripR = strips ? { x: x0, y, w: innerW, h: STRIP_H } : null
  if (strips) y += STRIP_H + GAP
  const half = Math.max(80, (view.h - EDGE - y - LINE_H - handH - 3 * GAP) / 2)
  // Main: opponent, type line, you. Combat: the type line rises, the battle band is the two halves meeting.
  // Fan-out (your turn, several opponents) keeps that vertical split and reserves a header row in the top half.
  const lineY = combat ? y : y + half + GAP
  const topY = combat ? y + LINE_H + GAP : y
  const bottomY = y + half + LINE_H + 2 * GAP
  const head = fanout ? COL_HEAD : 0
  const topH = half - RIBBON_H - head
  const top = { x: feltX, y: topY + RIBBON_H + head, w: feltW, h: fanout ? Math.max(36, topH) : half - RIBBON_H }
  const bottom = { x: feltX, y: bottomY, w: feltW, h: half - RIBBON_H }
  const hand = { x: feltX, y: bottomY + half + GAP, w: feltW, h: handH }
  const line = { x: x0, y: lineY, w: innerW, h: LINE_H }
  const sh = stackHeight(stackLen)
  const stackBase = combat ? bottomY + half - GAP : lineY - GAP
  return {
    side: { x: leftW, y: 0, w: view.w - leftW, h: view.h },
    strips: stripR,
    oppSeat: { x: x0, y: topY, w: seatW, h: half },
    oppRibbon: { x: feltX, y: topY + head, w: feltW, h: RIBBON_H },
    top,
    line,
    stack: { x: actX, y: stackBase - sh, w: actW, h: sh },
    act: { x: actX, y: combat ? topY : bottomY, w: actW, h: half },
    meSeat: { x: x0, y: bottomY + half - RIBBON_H, w: seatW, h: handH + RIBBON_H + GAP },
    meRibbon: { x: feltX, y: bottomY + half - RIBBON_H, w: feltW, h: RIBBON_H },
    bottom,
    hand,
    piles: { x: actX, y: hand.y, w: actW, h: handH },
    split: { x: 0, y: combat ? topY + half + GAP / 2 : lineY + LINE_H / 2, w: leftW, h: 0 },
  }
}
