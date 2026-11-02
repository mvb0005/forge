import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePeek } from '../popover/usePeek'
import type { LogEntry, PlayerDto } from '../protocol'
import { useForge } from '../store'
import { stepWords } from '../look/phase'

// The right-hand column: the game as a timeline. The engine's log, grouped by turn (its TURN entries), one
// row per event with a mark for its kind (from the entry's type) and the cards in it hoverable. Mana and
// phase lines are noise most of the time; "All" shows them. Only displays the log: nothing is inferred.

type Kind = { mark: string; tone: string; quiet?: boolean }

const KINDS: Record<string, Kind> = {
  STACK_ADD: { mark: '✦', tone: 'var(--lk-frost)' },
  STACK_RESOLVE: { mark: '↧', tone: 'var(--lk-parchment-dim)' },
  COMBAT: { mark: '⚔', tone: 'var(--lk-ember-text)' },
  DAMAGE: { mark: '✸', tone: 'var(--lk-ember-light)' },
  LIFE: { mark: '♥', tone: 'var(--lk-ember-light)' },
  ZONE_CHANGE: { mark: '⇢', tone: 'var(--lk-parchment-dim)' },
  LAND: { mark: '▲', tone: 'var(--lk-parchment-dim)' },
  DISCARD: { mark: '⇣', tone: 'var(--lk-parchment-dim)' },
  EFFECT_REPLACED: { mark: '↺', tone: 'var(--lk-steel-text)' },
  PLAYER_CONTROL: { mark: '⇄', tone: 'var(--lk-steel-text)' },
  MULLIGAN: { mark: '↻', tone: 'var(--lk-parchment-dim)' },
  GAME_OUTCOME: { mark: '♛', tone: 'var(--lk-gold)' },
  MATCH_RESULTS: { mark: '♛', tone: 'var(--lk-gold)' },
  INFORMATION: { mark: '·', tone: 'var(--lk-parchment-mute)' },
  MANA: { mark: '◆', tone: 'var(--lk-parchment-mute)', quiet: true },
  PHASE: { mark: '›', tone: 'var(--lk-parchment-mute)', quiet: true },
}
const OTHER: Kind = { mark: '·', tone: 'var(--lk-parchment-mute)' }
// The server sends the type's enum name; older fixtures carry its caption ("Add To Stack").
const CAPTIONS: Record<string, string> = { 'ADD TO STACK': 'STACK_ADD', 'RESOLVE STACK': 'STACK_RESOLVE', 'REPLACEMENT EFFECT': 'EFFECT_REPLACED', 'MATCH RESULT': 'MATCH_RESULTS' }
const kindOf = (type: string) => {
  const t = type.toUpperCase()
  return CAPTIONS[t] ?? t.replace(/ /g, '_')
}

type Turn = { key: number; title: string; who: string | null; events: { i: number; e: LogEntry }[] }

/** The log split at its TURN entries ("Turn 9 (Krenko AI)"); events before the first turn are the opening. */
function byTurn(log: LogEntry[], all: boolean): Turn[] {
  const turns: Turn[] = [{ key: -1, title: 'Opening', who: null, events: [] }]
  log.forEach((e, i) => {
    const kind = kindOf(e.type)
    if (kind === 'TURN') {
      const m = /^Turn (\d+)(?: \((.+)\))?/.exec(e.message)
      turns.push({ key: i, title: m ? `Turn ${m[1]}` : e.message, who: m?.[2] ?? null, events: [] })
    } else if (all || !(KINDS[kind] ?? OTHER).quiet) {
      turns[turns.length - 1].events.push({ i, e })
    }
  })
  return turns.filter((t) => t.key >= 0 || t.events.length)
}

/** A card the log names as "Name (id)": hover shows the card, as anywhere else on the table. */
function CardRef({ id, name }: { id: number; name: string }) {
  const known = useForge((s) => !!s.cards[id])
  const peek = usePeek({ kind: 'card', id })
  if (!known) return <>{name}</>
  return (
    <span {...peek} data-entity={`card:${id}`} style={{ color: 'var(--lk-parchment)', textDecoration: 'underline', textDecorationColor: 'var(--lk-metal-line)', textUnderlineOffset: 2, cursor: 'help' }}>
      {name}
    </span>
  )
}

const CARD_ID = / \((\d+)\)/g

/** What the log says, minus engine bookkeeping: "[Zone Changer: ...]" tails, "Life: " and "39 > 35". */
function tidy(text: string) {
  return text.replace(/\s*\[[^\]]*\]\s*$/g, '').replace(/^Life: /, '').replace(/(\d+) > (-?\d+)/g, '$1 → $2')
}

/** A log message with its cards hoverable (the engine writes "Name (id)") and the players' names picked out. */
function Message({ text, names }: { text: string; names: string[] }) {
  const cards = useForge((s) => s.cards)
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(CARD_ID)) {
    const id = Number(m[1])
    const name = cards[id]?.name
    const before = text.slice(last, m.index)
    if (name && before.endsWith(name)) {
      parts.push(...withNames(before.slice(0, -name.length), names, parts.length))
      parts.push(<CardRef key={`c${m.index}`} id={id} name={name} />)
    } else {
      parts.push(...withNames(before, names, parts.length))
    }
    last = m.index + m[0].length
  }
  parts.push(...withNames(text.slice(last), names, parts.length))
  return <>{parts}</>
}

function withNames(text: string, names: string[], k: number): ReactNode[] {
  if (!names.length || !text) return [text]
  const re = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
  return text.split(re).map((s, i) => (i % 2 ? <b key={`${k}n${i}`} className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{s}</b> : s))
}

export function Timeline() {
  const log = useForge((s) => s.game?.log)
  const players = useForge((s) => s.players)
  const phase = useForge((s) => s.game?.phase ?? null)
  const activeId = useForge((s) => s.game?.activePlayerId ?? null)
  const meIds = useForge((s) => s.game?.localPlayerIds)
  const [all, setAll] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const stuck = useRef(true) // follow the newest event unless the reader scrolled back
  const names = useMemo(() => Object.values(players).map((p: PlayerDto) => p.name).filter(Boolean), [players])
  const turns = useMemo(() => byTurn(log ?? [], all), [log, all])
  useEffect(() => {
    const el = ref.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, [turns])
  const active = activeId != null ? players[activeId] : undefined
  const now = active ? `${meIds?.includes(active.id) ? 'Your' : `${active.name}'s`} turn${stepWords(phase) ? ` · ${stepWords(phase)}` : ''}` : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="lk-title mb-2 flex items-baseline justify-between border-b pb-2" style={{ borderColor: 'var(--lk-metal-line)' }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>Timeline</span>
        <button type="button" onClick={() => setAll((a) => !a)} title="Mana and phase lines too"
          style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 12, color: all ? 'var(--lk-parchment)' : 'var(--lk-parchment-mute)' }}>
          {all ? 'Everything' : 'Key events'}
        </button>
      </div>
      <div ref={ref} onScroll={(e) => { const el = e.currentTarget; stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }}
        className="bf-scroll min-h-0 flex-1 overflow-y-auto pr-1" style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--lk-parchment-dim)' }}>
        {turns.map((t) => (
          <section key={t.key} style={{ position: 'relative', paddingLeft: 14, marginBottom: 10 }}>
            <span aria-hidden style={{ position: 'absolute', left: 4, top: 22, bottom: 0, width: 1, background: 'var(--lk-metal-faint)' }} />
            <div className="lk-title" style={{ position: 'sticky', top: 0, zIndex: 1, margin: '0 0 4px -14px', padding: '3px 0 3px 0', background: '#100c08', display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: 99, border: '1.5px solid var(--lk-metal)', background: '#100c08', flex: 'none', transform: 'translateY(1px)' }} />
              <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--lk-parchment)' }}>{t.title}</span>
              {t.who && <span style={{ fontSize: 12.5, color: 'var(--lk-parchment-dim)' }}>{meIds?.some((id) => players[id]?.name === t.who) ? 'You' : t.who}</span>}
            </div>
            {t.events.map(({ i, e }) => {
              const k = KINDS[kindOf(e.type)] ?? OTHER
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 4, padding: '2px 0' }}>
                  <span aria-hidden style={{ color: k.tone, textAlign: 'center' }}>{k.mark}</span>
                  <span>
                    <Message text={tidy(e.message)} names={names} />
                  </span>
                </div>
              )
            })}
          </section>
        ))}
        {now && (
          <div className="lk-title" style={{ display: 'flex', gap: 6, alignItems: 'baseline', paddingTop: 2, color: 'var(--lk-gold)', fontSize: 13 }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 99, background: 'var(--lk-gold)', flex: 'none', boxShadow: '0 0 8px var(--lk-gold-soft)' }} />
            Now: {now}
          </div>
        )}
      </div>
    </div>
  )
}
