import type { Region } from './contract'

// The table's chrome rectangles for a viewport: the two battlefield halves, the seam between
// them, the seats, the action column (stack, control panel, piles), the hand and
// the log. Combat does not insert a bar. The ring is drawn around the cards that step into it.
// The seam and the control panel stay put. Pure, so the card layout and the chrome agree.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

const GAP = 8
const EDGE = 18 // inside the mat's rim
export const LINE_H = 64
export const STRIP_H = 104
export const RIBBON_H = 50 // the strip above your hand that your seat plate reaches up into
export const COL_HEAD = 64 // the same player plaque, compact, above each opponent column
export const ACT_BUTTONS_H = 82 // Cancel over OK
export const ACT_H = 196 // the current action in large type, then the buttons. It does not move when combat starts.

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
  oppRibbon: Region // the focused opponent's land shelf: the layout carves it off the right of `top`
  top: Region // opponent's battlefield (cards)
  line: Region // the type line
  stack: Region
  act: Region // the action plate
  meSeat: Region
  meRibbon: Region // your land shelf, off the right of `bottom`
  bottom: Region // your battlefield (cards)
  hand: Region
  piles: Region // your library, graveyard, exile, command
  tray: Region // unused strip. Combat is a ring around the cards, so this stays empty.
  split: Region // y where the two coloured halves meet (h = 0)
}

export function tableFrame(view: { w: number; h: number }, strips: boolean, stackLen: number, _combat = false, fanout = false): Frame {
  const sideW = clamp(view.w * 0.15, 220, 300)
  const leftW = Math.max(400, view.w - sideW)
  // A duel keeps a seat gutter on the left. With every player in a band, that gutter is gone: the seat, its commander and the buttons are the right column.
  const seatW = fanout ? 0 : clamp(view.w * 0.1, 150, 210)
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
  // The seam stays between the two halves. Combat draws a ring across it; nothing else moves.
  const lineY = y + half + GAP
  const topY = y
  const bottomY = lineY + LINE_H + GAP
  const head = fanout ? COL_HEAD : 0
  void _combat
  const top = { x: feltX, y: topY + head, w: feltW, h: Math.max(36, half - head) }
  const bottom = { x: feltX, y: bottomY, w: feltW, h: half }
  const hand = { x: feltX, y: bottomY + half + GAP, w: feltW, h: handH }
  const line = { x: x0, y: lineY, w: innerW, h: LINE_H }
  const sh = stackHeight(stackLen)
  if (fanout) {
    // Every player, including you, is a full-width band from the top rim down to the hand.
    // Seat profiles share the column on the right. Your seat keeps going to the bottom edge, and the buttons sit inside it.
    const hand = { x: feltX, y: view.h - EDGE - handH, w: feltW, h: handH }
    const boardTop = EDGE
    const boardH = Math.max(160, hand.y - GAP - boardTop)
    const board = { x: feltX, y: boardTop, w: feltW, h: boardH }
    const act = { x: actX, y: hand.y, w: actW, h: handH }
    return {
      side: { x: leftW, y: 0, w: view.w - leftW, h: view.h },
      strips: null,
      oppSeat: { x: x0, y: boardTop, w: seatW, h: boardH },
      oppRibbon: { x: feltX + feltW, y: boardTop, w: 0, h: 0 },
      top: board,
      line: { x: x0, y: boardTop + boardH, w: innerW, h: 0 },
      stack: { x: actX, y: Math.max(EDGE, act.y - GAP - sh), w: actW, h: sh },
      act,
      meSeat: { x: x0, y: hand.y, w: seatW, h: handH },
      meRibbon: { x: feltX + feltW, y: hand.y, w: 0, h: 0 },
      bottom: { x: board.x, y: board.y, w: board.w, h: board.h },
      hand,
      piles: { x: actX, y: hand.y, w: actW, h: handH },
      tray: { x: feltX, y: boardTop + boardH, w: feltW, h: 0 },
      split: { x: 0, y: boardTop + boardH, w: leftW, h: 0 },
    }
  }
  const stackBase = lineY - GAP
  return {
    side: { x: leftW, y: 0, w: view.w - leftW, h: view.h },
    strips: stripR,
    oppSeat: { x: x0, y: topY, w: seatW, h: half },
    oppRibbon: { x: feltX + feltW, y: top.y, w: 0, h: top.h },
    top,
    line,
    stack: { x: actX, y: stackBase - sh, w: actW, h: sh },
    act: { x: actX, y: hand.y - GAP - ACT_H, w: actW, h: ACT_H },
    meSeat: { x: x0, y: bottomY + half - RIBBON_H, w: seatW, h: handH + RIBBON_H + GAP },
    meRibbon: { x: feltX + feltW, y: bottom.y, w: 0, h: bottom.h },
    bottom,
    hand,
    piles: { x: actX, y: hand.y, w: actW, h: handH },
    tray: { x: feltX, y: bottomY, w: feltW, h: 0 },
    split: { x: 0, y: lineY + LINE_H / 2, w: leftW, h: 0 },
  }
}
