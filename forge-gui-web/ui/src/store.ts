import { create } from 'zustand'
import type { AssistMessage, Ask, BlockersAssist, CardDto, CombatAssist, CombatDto, EntityRef, GameDto, LogEntry, ManaAssist, PlayerDto, ServerMessage, StackItemDto } from './protocol'

// Shared client state. net.ts feeds server messages into apply(); components only read.
export type ForgeState = {
  connected: boolean
  inMatch: boolean
  who: string | null
  returnUrl: string | null // where the game-over and ended screens send you back to (the tracker)
  ended: { summary: string | null } | null // this seat's match was over before we connected
  game: GameDto | null
  players: Record<number, PlayerDto>
  cards: Record<number, CardDto>
  stack: StackItemDto[]
  combat: CombatDto | null
  combatAssist: CombatAssist | null // engine's combat prediction (assist channel)
  blockersAssist: BlockersAssist | null // who may block each attacker, while you declare blockers
  manaAssist: ManaAssist | null // what each player's untapped sources could add now
  caps: string[] // server capabilities from hello
  prompt: { playerId: number; message: string; cardId: number | null } | null
  buttons: { ok: { label: string; enabled: boolean }; cancel: { label: string; enabled: boolean }; focusOk: boolean } | null
  selectable: { cardIds: Set<number>; playerIds?: Set<number>; min: number; max: number }
  highlighted: Set<string> // entityKey()
  playable: Set<number>
  ask: Ask | null
  reveal: { title: string; cardIds: number[] } | null
  notices: { id: number; level: 'info' | 'error' | 'flash'; title: string; message: string }[]
  gameOver: { winner: string | null; summary: string } | null
  respondBy: number | null // Date.now() ms when the server passes priority for you, if it's timing you
  setConnected: (c: boolean) => void
  dismissNotice: (id: number) => void
  clearReveal: () => void
  clearAsk: () => void
  clearGameOver: () => void
  apply: (m: ServerMessage) => void
}

export const entityKey = (e: EntityRef) => `${e.kind}:${e.id}`

const LOG_LIMIT = 200

// One reducer per assist kind; unknown kinds are ignored.
type AssistReducer<K extends AssistMessage['kind']> = (m: Extract<AssistMessage, { kind: K }>) => Partial<ForgeState>
const assistReducers: { [K in AssistMessage['kind']]: AssistReducer<K> } = {
  combat: (m) => ({ combatAssist: m.combat }),
  blockers: (m) => ({ blockersAssist: m.blockers }),
  mana: (m) => ({ manaAssist: m.mana }),
}

function applyAssist(m: AssistMessage): Partial<ForgeState> {
  const r = assistReducers[m.kind] as ((m: AssistMessage) => Partial<ForgeState>) | undefined
  return r ? r(m) : {}
}

function nextLog(prev: LogEntry[], m: Extract<ServerMessage, { t: 'state' }>): LogEntry[] {
  const legacy = (m.game as Partial<GameDto> | undefined)?.log // dev fixtures still carry game.log
  if (legacy) return legacy
  if (m.logReset) return (m.logAppend ?? []).slice(-LOG_LIMIT)
  if (m.full) return []
  if (!m.logAppend?.length) return prev
  const log = prev.concat(m.logAppend)
  return log.length > LOG_LIMIT ? log.slice(-LOG_LIMIT) : log
}

// Cards keep their identity when an upsert changes nothing, so per-card subscribers don't re-render.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

let noticeSeq = 0

export const useForge = create<ForgeState>()((set) => ({
  connected: false,
  inMatch: false,
  who: null,
  returnUrl: null,
  ended: null,
  game: null,
  players: {},
  cards: {},
  stack: [],
  combat: null,
  combatAssist: null,
  blockersAssist: null,
  manaAssist: null,
  caps: [],
  prompt: null,
  buttons: null,
  selectable: { cardIds: new Set(), playerIds: new Set(), min: 0, max: 0 },
  highlighted: new Set(),
  playable: new Set(),
  ask: null,
  reveal: null,
  notices: [],
  gameOver: null,
  respondBy: null,
  setConnected: (connected) => set({ connected }),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  clearReveal: () => set({ reveal: null }),
  clearAsk: () => set({ ask: null }),
  clearGameOver: () => set({ gameOver: null }),
  apply: (m) =>
    set((s): Partial<ForgeState> => {
      switch (m.t) {
        case 'hello':
          return { inMatch: m.inMatch, caps: m.caps ?? [], who: m.who ?? null, returnUrl: m.returnUrl ?? null, ended: null, respondBy: null }
        case 'ended':
          return { inMatch: false, ended: { summary: m.summary ?? null } }
        case 'state': {
          const players = m.full ? {} : { ...s.players }
          const cards = m.full ? {} : { ...s.cards }
          for (const p of m.players ?? []) players[p.id] = players[p.id] && sameValue(players[p.id], p) ? players[p.id] : p
          for (const c of m.cards ?? []) {
            const prev = cards[c.id]
            cards[c.id] = prev && sameValue(prev, c) ? prev : c
          }
          for (const id of m.removedCards ?? []) delete cards[id]
          const prevLog = s.game?.log ?? []
          const log = nextLog(prevLog, m)
          const base = m.game ?? s.game
          return {
            inMatch: true,
            gameOver: m.full ? null : s.gameOver,
            game: base && (m.game || log !== prevLog) ? { ...base, log } : s.game,
            players,
            cards,
            stack: m.stack ?? (m.full ? [] : s.stack),
            combat: m.combat !== undefined ? m.combat : m.full ? null : s.combat,
          }
        }
        case 'prompt':
          return { prompt: { playerId: m.playerId, message: m.message, cardId: m.cardId } }
        case 'buttons':
          return { buttons: { ok: m.ok, cancel: m.cancel, focusOk: m.focusOk } }
        case 'selectables':
          return { selectable: { cardIds: new Set(m.cardIds), playerIds: new Set(m.playerIds ?? []), min: m.min, max: m.max } }
        case 'highlight': {
          const highlighted = new Set(s.highlighted)
          for (const e of m.entities) {
            if (m.on) highlighted.add(entityKey(e))
            else highlighted.delete(entityKey(e))
          }
          return { highlighted }
        }
        case 'playable':
          return { playable: new Set(m.cardIds) }
        case 'notice':
          return { notices: [...s.notices, { id: ++noticeSeq, level: m.level, title: m.title, message: m.message }] }
        case 'reveal':
          return { reveal: { title: m.title, cardIds: m.cardIds } }
        case 'ask':
          return { ask: m }
        case 'assist':
          return applyAssist(m)
        case 'gameOver':
          return { gameOver: { winner: m.winner, summary: m.summary }, respondBy: null }
        case 'timer':
          return { respondBy: m.seconds == null ? null : Date.now() + m.seconds * 1000 }
        case 'error':
          return { notices: [...s.notices, { id: ++noticeSeq, level: 'error', title: 'Error', message: m.message }] }
        default:
          console.warn('unhandled server message', m)
          return {}
      }
    }),
}))
