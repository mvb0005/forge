import type { ClientMessage } from './protocol'

// The WebSocket connection. Owned by the shell; components only call send().
let socket: WebSocket | null = null
let tap: ((m: ClientMessage) => void) | null = null

// Returns false when the message could not be sent (not connected).
export function send(m: ClientMessage): boolean {
  if (tap) {
    tap(m)
    return true
  }
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(m))
    return true
  }
  console.warn('not connected, dropped', m)
  return false
}

export function setSocket(ws: WebSocket | null) {
  socket = ws
}

// Dev fixtures only: route every outgoing message to fn instead of the socket.
export function setSendTap(fn: ((m: ClientMessage) => void) | null) {
  tap = fn
}
