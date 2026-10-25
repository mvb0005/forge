// The Inspect gesture (open question Q-03), in one place. Right-click stays Forge's "remove from
// combat", Space/Enter pass priority, Shift goes to the engine with clicks, Alt is the threat lens:
// so "I" pins whatever is being peeked (hover or keyboard focus), and "I" again or Esc unpins.
export const INSPECT_KEY = 'i'

export function isInspectKey(e: KeyboardEvent) {
  return e.key.toLowerCase() === INSPECT_KEY && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)
}

export function isTyping(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)
}
