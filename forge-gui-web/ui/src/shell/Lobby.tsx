import { useEffect, useMemo, useState } from 'react'
import { send } from '../net'
import type { LobbyDeck as Deck, MatchFormat, SavedGame } from '../protocol'
import { useForge } from '../store'
import { Btn, ColorPips, Kbd } from './ui'

const remember = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(k)
    localStorage.setItem(k, v)
  } catch {
    /* storage unavailable */
  }
  return null
}

const colorName: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }
const guildish = (c: string) => [...c].map((x) => colorName[x] ?? x).join(' · ') || 'Colourless'
const stripe: Record<string, string> = { W: 'var(--color-mana-w)', U: 'var(--color-mana-u)', B: 'var(--color-mana-b)', R: 'var(--color-mana-r)', G: 'var(--color-mana-g)' }
const stripeOf = (c: string) => {
  const cs = [...c].map((x) => stripe[x]).filter(Boolean)
  if (cs.length === 0) return 'var(--color-mana-c)'
  if (cs.length === 1) return cs[0]
  return `linear-gradient(90deg, ${cs.map((x, i) => `${x} ${(i / cs.length) * 100}% ${((i + 1) / cs.length) * 100}%`).join(', ')})`
}

// Generated two-colour decks ('random:WU') show as pips; Commander's random choices ('cmdr:random', 'cmdr:randomprecon') as words.
const isRandom = (d: Deck) => d.id.startsWith('random:') || d.id === 'cmdr:random' || d.id === 'cmdr:randomprecon'

function DeckPicker({ label, decks, value, onChange, randomTitle }: { label: string; decks: Deck[]; value: string; onChange: (id: string) => void; randomTitle: string }) {
  const [q, setQ] = useState('')
  const current = decks.find((d) => d.id === value)
  const random = decks.filter(isRandom)
  const needle = q.toLowerCase()
  const named = decks.filter((d) => !isRandom(d) && (d.name.toLowerCase().includes(needle) || !!d.detail?.toLowerCase().includes(needle)))
  const pips = !current || !!current.colors || current.id.startsWith('random:')
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl lk-plate">
      <div className="relative overflow-hidden rounded-t-xl border-b border-line px-5 pb-4 pt-5">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: stripeOf(current?.colors ?? '') }} />
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">{label}</div>
        <div className="mt-1.5 flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate font-title text-xl font-bold">{current?.name ?? 'Choose a deck'}</span>
          {current && pips && <ColorPips colors={current.colors} size={20} />}
        </div>
        <div className="mt-0.5 truncate text-xs text-ink-dim">{current ? (pips ? [guildish(current.colors), current.detail].filter(Boolean).join(' · ') : current.detail) : ' '}</div>
      </div>
      {random.length > 0 && (
        <div className="border-b border-line px-4 py-3">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-dim">{randomTitle}</div>
          <div className="flex flex-wrap gap-1.5">
            {random.map((d) => (
              <button key={d.id} type="button" title={d.detail ?? d.name} onClick={() => onChange(d.id)}
                className={`rounded-full border px-2 py-1 transition ${d.id === value ? 'border-accent bg-accent/10' : 'border-line hover:border-ink-dim'}`}>
                {d.id.startsWith('random:') ? <ColorPips colors={d.colors} size={16} /> : <span className="px-1.5 font-title text-sm font-semibold">{d.name}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="px-4 pt-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search decks"
          className="w-full rounded-lg border border-line bg-table px-3 py-2 text-sm outline-none transition placeholder:text-ink-dim focus:border-accent" />
      </div>
      <ul className="shell-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {named.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onChange(d.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition
                ${d.id === value ? 'bg-accent/12 text-ink ring-1 ring-accent/60' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{d.name}</span>
                {d.detail && <span className="block truncate text-[11px] text-ink-dim">{d.detail}</span>}
              </span>
              <ColorPips colors={d.colors} size={14} />
            </button>
          </li>
        ))}
        {named.length === 0 && <li className="px-3 py-4 text-sm text-ink-dim">{q ? 'No deck matches' : 'No saved decks on the server'}</li>}
      </ul>
    </div>
  )
}

function when(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function gameLabel(g: SavedGame) {
  if (g.summary) return g.summary
  if (g.status === 'playing') return 'In progress'
  if (g.status === 'abandoned') return 'Abandoned'
  return g.status
}

export function Lobby() {
  const lobby = useForge((s) => s.lobby)!
  const connected = useForge((s) => s.connected)
  const email = useForge((s) => s.email)
  const games = lobby.games ?? []
  const commanderOk = useForge((s) => s.caps.includes('match.commander')) && lobby.commanderDecks.length > 0
  const [format, setFormatState] = useState<MatchFormat>(() => (commanderOk && remember('forge.format') === 'commander' ? 'commander' : 'constructed'))
  const cmdr = format === 'commander'
  const decks = cmdr ? lobby.commanderDecks : lobby.decks
  // Each format remembers its own picks: forge.deck, forge.cmdr.deck and so on.
  const keyOf = (c: boolean, k: string) => (c ? `forge.cmdr.${k}` : `forge.${k}`)
  const pickFor = (c: boolean, k: string, fallback: number) => {
    const list = c ? lobby.commanderDecks : lobby.decks
    const saved = remember(keyOf(c, k))
    if (saved && list.some((d) => d.id === saved)) return saved
    if (c && list.some((d) => d.id === 'cmdr:randomprecon')) return 'cmdr:randomprecon'
    return list[Math.min(fallback, list.length - 1)]?.id ?? ''
  }
  const opponentsFor = (c: boolean) => Math.min(3, Math.max(1, Number(remember(keyOf(c, 'opponents'))) || (c ? 3 : 1)))
  const [mine, setMine] = useState(() => pickFor(cmdr, 'deck', 0))
  const [theirs, setTheirs] = useState(() => pickFor(cmdr, 'opponentDeck', 1))
  const [opponents, setOpponents] = useState(() => opponentsFor(cmdr))
  const setFormat = (f: MatchFormat) => {
    if (f === format) return
    const c = f === 'commander'
    setFormatState(f)
    setMine(pickFor(c, 'deck', 0))
    setTheirs(pickFor(c, 'opponentDeck', 1))
    setOpponents(opponentsFor(c))
  }
  // A new lobby message after Start means the server refused; starting is only valid for the lobby it was sent from.
  const [started, setStarted] = useState<{ what: string; lobby: object } | null>(null)
  const starting = started?.lobby === lobby ? started.what : null
  const setStarting = (what: string) => setStarted({ what, lobby })

  const canStart = connected && !!mine && !!theirs && !starting
  const start = () => {
    if (!canStart) return
    remember('forge.format', format)
    remember(keyOf(cmdr, 'deck'), mine)
    remember(keyOf(cmdr, 'opponentDeck'), theirs)
    remember(keyOf(cmdr, 'opponents'), String(opponents))
    if (send(cmdr ? { t: 'startMatch', format, deck: mine, opponentDeck: theirs, opponents } : { t: 'startMatch', deck: mine, opponentDeck: theirs, opponents })) setStarting('match')
  }
  const startState = (state: string) => {
    if (connected && !starting && send({ t: 'startState', state })) setStarting(state)
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (useForge.getState().gameOver) return
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement)) start()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const states = useMemo(() => lobby.states.map((s) => ({ path: s, name: s.split(/[\\/]/).pop()!.replace(/\.txt$/, '') })), [lobby.states])

  return (
    <div className="flex h-full flex-col" style={{ background: 'radial-gradient(ellipse 80% 60% at 30% 0%, #2a2118 0%, #120e0a 55%, #0a0806 100%)' }}>
      <header className="flex items-center gap-3 px-8 pb-2 pt-6">
        <span className="font-title text-3xl font-bold">Forge</span>
        <span className="rounded bg-panel-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-ink-dim">web</span>
        <span className="flex-1" />
        <span className="flex items-center gap-2 text-xs text-ink-dim">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-playable' : 'bg-danger'}`} />
          {email ?? (connected ? 'Connected' : 'Offline')}
        </span>
      </header>
      {games.length > 0 && (
        <div className="shell-scroll flex gap-2 overflow-x-auto px-8 pb-1">
          {games.map((g) => (
            <div key={g.id} className="w-56 shrink-0 rounded-lg border border-line bg-panel/60 px-3 py-2">
              <div className="truncate text-xs font-semibold">{gameLabel(g)}</div>
              <div className="truncate text-[11px] text-ink-dim">{g.format === 'commander' ? 'Commander · ' : ''}{g.deckName} vs {g.opponentDeckName}</div>
              <div className="text-[11px] text-ink-dim">{when(g.endedAt ?? g.startedAt)}</div>
            </div>
          ))}
        </div>
      )}

      <main className="flex min-h-0 flex-1 gap-6 px-8 pb-8 pt-4">
        <section className="flex min-h-0 min-w-0 flex-[3] flex-col gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">New match</h1>
            {commanderOk && (
              <div className="inline-flex rounded-lg border border-line bg-table p-0.5" role="tablist" aria-label="Format">
                {(['constructed', 'commander'] as const).map((f) => (
                  <button key={f} type="button" role="tab" aria-selected={f === format} onClick={() => setFormat(f)}
                    className={`h-8 rounded-md px-4 font-title text-sm transition ${f === format ? 'bg-panel-2 font-semibold text-ink ring-1 ring-accent/60' : 'text-ink-dim hover:text-ink'}`}>
                    {f === 'constructed' ? 'Constructed' : 'Commander'}
                  </button>
                ))}
              </div>
            )}
            {cmdr && <span className="text-xs text-ink-dim">40 life · commander tax · 21 commander damage</span>}
          </div>
          <div className="flex min-h-0 flex-1 items-stretch gap-4">
            <DeckPicker key={`${format}:mine`} label={cmdr ? 'Your commander deck' : 'Your deck'} decks={decks} value={mine} onChange={setMine} randomTitle={cmdr ? 'Random' : 'Random two-colour'} />
            <div className="grid w-10 shrink-0 place-items-center font-title text-lg font-bold text-ink-dim">VS</div>
            <DeckPicker key={`${format}:theirs`} label={opponents > 1 ? (cmdr && theirs === 'cmdr:randomprecon' ? `Opponents' decks ×${opponents}` : `Opponents' deck ×${opponents}`) : "Opponent's deck"} decks={decks} value={theirs} onChange={setTheirs} randomTitle={cmdr ? 'Random' : 'Random two-colour'} />
          </div>
          <div className="flex items-center gap-5 rounded-xl lk-plate px-5 py-4">
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-dim">Opponents</div>
              <div className="inline-flex rounded-lg border border-line bg-table p-0.5">
                {[1, 2, 3].map((n) => (
                  <button key={n} type="button" onClick={() => setOpponents(n)}
                    className={`h-8 w-11 rounded-md text-sm transition ${n === opponents ? 'bg-panel-2 font-semibold text-ink ring-1 ring-accent/60' : 'text-ink-dim hover:text-ink'}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-sm text-ink-dim">{opponents === 1 ? 'One-on-one' : `Free-for-all, ${opponents + 1} players`}{cmdr ? ' · Commander' : ''}</div>
            <span className="flex-1" />
            <span className="hidden items-center gap-1.5 text-xs text-ink-dim md:inline-flex"><Kbd>Enter</Kbd> start</span>
            <Btn variant="primary" className="px-8 py-3 text-base" disabled={!canStart} onClick={start}>
              {starting === 'match' ? 'Starting…' : 'Start match'}
            </Btn>
          </div>
        </section>

        <aside className="flex min-h-0 w-80 shrink-0 flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">Saved boards</h2>
          <ul className="shell-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-xl lk-plate p-2">
            {states.map((s) => (
              <li key={s.path}>
                <button type="button" disabled={!connected || !!starting} onClick={() => startState(s.path)} title={s.path}
                  className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-panel-2 disabled:opacity-50">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-felt text-xs text-ink-dim">▦</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{s.name}</span>
                    <span className="block truncate text-[11px] text-ink-dim">{s.path}</span>
                  </span>
                  <span className="text-xs text-accent opacity-0 transition group-hover:opacity-100">{starting === s.path ? 'Loading…' : 'Load'}</span>
                </button>
              </li>
            ))}
            {states.length === 0 && <li className="px-3 py-4 text-sm text-ink-dim">No saved boards</li>}
          </ul>
        </aside>
      </main>
    </div>
  )
}
