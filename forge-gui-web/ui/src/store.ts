import { create } from 'zustand'
import type { CombatMemo } from './board/combatStory'
import { isCombat } from './look/phase'
import type { AssistMessage, Ask, BlockersAssist, CardDto, CombatAssist, CombatDto, EntityRef, GameDto, GameWire, LogEntry, ManaAssist, PlayerDto, ServerMessage, StackItemDto, YieldDto } from './protocol'

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
  reveal: Reveal | null // the latest reveal, shown at the revealer's seat for a moment (RevealFlyout)
  reveals: Reveal[] // this game's reveals, for the Timeline (after the log entry that came before each)
  revealOpen: number | null // the reveal key someone reopened from the Timeline
  notices: { id: number; level: 'info' | 'error' | 'flash'; title: string; message: string; stackId?: number }[]
  gameOver: { winner: string | null; summary: string } | null
  respondBy: number | null // Date.now() ms when the server passes priority for you, if it's timing you
  ahead: { round: number; open: boolean; passed: boolean } | null // passing ahead while you wait (PassAhead)
  autopass: { yield: YieldDto | null; hold: boolean; stopped: string | null; stackId: number | null } // pass until … (PassMenu)
  speaking: Set<string> // Discord user ids talking in the Activity's voice channel now (discord.ts)
  pip: boolean // Discord Activity is minimized into Picture-in-Picture
  combatMemo: CombatMemo | null // this turn's combat: life when it began and who fought (combatStory's recap)
  setConnected: (c: boolean) => void
  dismissNotice: (id: number) => void
  clearReveal: () => void
  openReveal: (key: number | null) => void
  clearAsk: () => void
  clearGameOver: () => void
  apply: (m: ServerMessage) => void
}

// A reveal as the client keeps it: the cards as they looked when revealed (a revealed hand card goes back to being
// hidden), and who revealed them (a player named in the title, else the owner of most of the cards).
export type Reveal = { key: number; title: string; cardIds: number[]; cards: CardDto[]; ownerId: number | null; after: LogEntry | null }

function revealer(title: string, cards: CardDto[], players: Record<number, PlayerDto>): number | null {
  const named = Object.values(players).filter((p) => p.name && title.includes(p.name))
  if (named.length === 1) return named[0].id
  const n = new Map<number, number>()
  for (const c of cards) n.set(c.ownerId, (n.get(c.ownerId) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

let revealSeq = 0

// A selector must return the same value for the same state: a fresh `[]` on every read (s.game?.x ?? []) makes
// React see the store change each render and loop until it gives up (error #185), as it did for a spectator
// before the first state. Fall back to this instead.
export const NO_IDS: number[] = []

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

// The last combat's memory for the recap (until the next combat begins): the life everyone had as combat began (before this state's changes), and every
// creature that attacked or blocked, by name (a card that leaves for a hidden zone drops out of the store).
function nextCombatMemo(
  memo: CombatMemo | null, game: GameWire | null | undefined, before: Record<number, PlayerDto>,
  players: Record<number, PlayerDto>, cards: Record<number, CardDto>, combat: CombatDto | null,
): CombatMemo | null {
  if (!game) return memo
  if (!isCombat(game.phase)) return memo // kept until the next combat, so a defender sees it on their own turn too
  const bands = combat?.bands ?? []
  // A new turn's combat replaces the last one only once something attacks: a combat with no attacks keeps the recap.
  if (memo && memo.turn !== game.turn && !bands.some((b) => b.attackerIds.length)) return memo
  let next = memo?.turn === game.turn ? memo : null
  if (!next) {
    const life: Record<number, number> = {}
    for (const p of Object.values(Object.keys(before).length ? before : players)) life[p.id] = p.life
    next = { turn: game.turn, attackerId: game.activePlayerId, life, ids: [], names: {} }
  }
  const fresh = bands.flatMap((b) => [...b.attackerIds, ...b.blockerIds]).filter((id) => !next.ids.includes(id))
  if (!fresh.length) return next
  const names = { ...next.names }
  for (const id of fresh) if (cards[id]) names[id] = cards[id].name
  return { ...next, ids: [...next.ids, ...fresh], names }
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
  reveals: [],
  revealOpen: null,
  notices: [],
  gameOver: null,
  respondBy: null,
  ahead: null,
  autopass: { yield: null, hold: false, stopped: null, stackId: null },
  speaking: new Set(),
  pip: false,
  combatMemo: null,
  setConnected: (connected) => set({ connected }),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  clearReveal: () => set({ reveal: null }),
  openReveal: (key) => set({ revealOpen: key }),
  clearAsk: () => set({ ask: null }),
  clearGameOver: () => set({ gameOver: null }),
  apply: (m) =>
    set((s): Partial<ForgeState> => {
      switch (m.t) {
        case 'hello':
          return { inMatch: m.inMatch, caps: m.caps ?? [], who: m.who ?? null, returnUrl: m.returnUrl ?? null, ended: null, respondBy: null, ahead: null, autopass: { yield: null, hold: false, stopped: null, stackId: null } }
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
          const combat = m.combat !== undefined ? m.combat : m.full ? null : s.combat
          return {
            combatMemo: nextCombatMemo(m.full ? null : s.combatMemo, base, m.full ? players : s.players, players, cards, combat),
            inMatch: true,
            gameOver: m.full ? null : s.gameOver,
            game: base && (m.game || log !== prevLog) ? { ...base, log } : s.game,
            players,
            cards,
            stack: m.stack ?? (m.full ? [] : s.stack),
            combat,
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
          return { notices: [...s.notices, { id: ++noticeSeq, level: m.level, title: m.title, message: m.message, stackId: m.stackId }] }
        case 'reveal': {
          if (!m.cardIds.length) return { reveal: null }
          const last = s.reveals[s.reveals.length - 1]
          const log = s.game?.log
          const anchor = log?.length ? log[log.length - 1] : null
          // The same cards again is the same reveal: re-sent after a full state (a reconnect), or the engine's second
          // word on it ("You reveal", then "Looking at cards in your library") before anything else happened.
          if (last && last.cardIds.join() === m.cardIds.join() && (last.title === m.title || last.after === anchor)) return { reveal: last }
          const cards = m.cardIds.map((id) => s.cards[id]).filter((c): c is CardDto => !!c)
          const r: Reveal = { key: ++revealSeq, title: m.title, cardIds: m.cardIds, cards, ownerId: revealer(m.title, cards, s.players), after: anchor }
          return { reveal: r, reveals: [...s.reveals.slice(-29), r] }
        }
        case 'ask':
          return { ask: m }
        case 'assist':
          return applyAssist(m)
        case 'gameOver':
          return { gameOver: { winner: m.winner, summary: m.summary }, respondBy: null, ahead: null }
        case 'timer':
          return { respondBy: m.seconds == null ? null : Date.now() + m.seconds * 1000 }
        case 'ahead':
          return { ahead: { round: m.round, open: m.open, passed: m.passed } }
        case 'autopass':
          return { autopass: { yield: m.yield, hold: m.hold, stopped: m.stopped ?? null, stackId: m.stackId ?? null } }
        case 'error':
          return { notices: [...s.notices, { id: ++noticeSeq, level: 'error', title: 'Error', message: m.message }] }
        default:
          console.warn('unhandled server message', m)
          return {}
      }
    }),
}))
