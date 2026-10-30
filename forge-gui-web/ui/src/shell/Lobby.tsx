import '@fontsource/spectral/latin-600.css'
import '@fontsource/spectral/latin-700.css'
import './landing.css'
import { useEffect, useMemo, useState } from 'react'
import { ManaSymbol } from '../look/ManaSymbol'
import { send } from '../net'
import type { CuratedOpponent, LobbyDeck, SavedGame } from '../protocol'
import { useForge } from '../store'

// The landing page at /play. It reads your decks from mtg-tracker on the same host (your own sign-in
// cookie) and the server plays the list it's sent; without a tracker (local play) it offers Forge's precons.

const remember = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(k)
    localStorage.setItem(k, v)
  } catch {
    /* storage unavailable */
  }
  return null
}

type TrackerDeck = { id: number; name: string; format: string; commander: string | null; counts: { list: number; here: number; away: number; wanted: number } }
type Tracker =
  | { state: 'loading' }
  | { state: 'none'; status: number }
  | { state: 'ok'; who: string; decks: TrackerDeck[] }

class TrackerError extends Error {
  status: number
  constructor(status: number) {
    super(`tracker ${status}`)
    this.status = status
  }
}

async function trackerJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
  // An HTML page (no tracker on this host, or its sign-in page) counts as a failure with its status.
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new TrackerError(r.ok ? 0 : r.status)
  return r.json() as Promise<T>
}

function useTracker(): Tracker {
  const [t, setT] = useState<Tracker>({ state: 'loading' })
  useEffect(() => {
    let live = true
    Promise.all([
      trackerJson<{ principal: { name: string } }>('/api/v1/me'),
      trackerJson<{ decks: TrackerDeck[] }>('/api/v1/decks'),
    ])
      .then(([me, d]) => live && setT({ state: 'ok', who: me.principal.name, decks: d.decks.filter((x) => x.format.toLowerCase() === 'commander') }))
      .catch((e) => live && setT({ state: 'none', status: e instanceof TrackerError ? e.status : 0 }))
    return () => {
      live = false
    }
  }, [])
  return t
}

const inkVar: Record<string, string> = { W: 'var(--tk-ink-W)', U: 'var(--tk-ink-U)', B: 'var(--tk-ink-B)', R: 'var(--tk-ink-R)', G: 'var(--tk-ink-G)' }
const firstInk = (colors: string) => inkVar[colors[0]] ?? 'var(--tk-accent)'
const stripeOf = (colors: string) => {
  const cs = [...colors].map((c) => inkVar[c]).filter(Boolean)
  if (cs.length === 0) return undefined
  return `linear-gradient(90deg, ${cs.map((x, i) => `${x} ${(i / cs.length) * 100}% ${((i + 1) / cs.length) * 100}%`).join(', ')})`
}

function Pips({ colors }: { colors: string }) {
  if (!colors) return <span className="tk-pips"><ManaSymbol sym="C" size={16} shadow={false} /></span>
  return <span className="tk-pips">{[...colors].map((c) => <ManaSymbol key={c} sym={c} size={16} shadow={false} />)}</span>
}

function when(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function result(g: SavedGame) {
  if (g.summary) return g.summary
  if (g.status === 'playing') return 'In progress'
  if (g.status === 'abandoned') return 'Abandoned'
  return g.status
}

const MAX_OPPONENTS = 3

export function Lobby() {
  const lobby = useForge((s) => s.lobby)!
  const connected = useForge((s) => s.connected)
  const email = useForge((s) => s.email)
  const tracker = useTracker()
  const roster = lobby.opponents
  const precons = lobby.commanderDecks

  // Your deck: a tracker deck id ("t:12") or a Forge commander deck id ("cmdr:precon:…").
  const [mine, setMine] = useState<string | null>(() => remember('forge.play.deck'))
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>(() => {
    const saved = (remember('forge.play.opponents') ?? '').split(',').filter((id) => roster.some((o) => o.id === id))
    return saved.length ? saved.slice(0, MAX_OPPONENTS) : roster.slice(0, 1).map((o) => o.id)
  })
  const [colors, setColors] = useState<Record<number, string>>({})
  const [started, setStarted] = useState<object | null>(null)
  const [problem, setProblem] = useState('')
  const [fetching, setFetching] = useState(false)
  const starting = fetching || started === lobby // a new lobby message after Start means the server refused
  // The server's refusal (an unknown card, no commander) shows here rather than as a table toast.
  const [since, setSince] = useState(Infinity)
  const refusal = useForge((s) => s.notices.filter((n) => n.level === 'error' && n.id > since).at(-1))

  const trackerDecks = tracker.state === 'ok' ? tracker.decks : []
  const fromTracker = tracker.state === 'ok'
  const chosenTracker = fromTracker ? trackerDecks.find((d) => `t:${d.id}` === mine) : undefined
  const chosenPrecon = !fromTracker ? precons.find((d) => d.id === mine) : undefined
  useEffect(() => {
    // Default to the first playable deck once the list is known.
    if (tracker.state === 'loading') return
    if (fromTracker ? !chosenTracker : !chosenPrecon) {
      const first = fromTracker ? trackerDecks.find((d) => d.commander) : precons.find((d) => d.id === 'cmdr:randomprecon') ?? precons[0]
      if (first) setMine(fromTracker ? `t:${(first as TrackerDeck).id}` : (first as LobbyDeck).id)
    }
  }, [tracker.state])

  // The tracker's deck list has no colours; read the chosen deck's identity when it's picked.
  useEffect(() => {
    if (!chosenTracker || colors[chosenTracker.id] !== undefined) return
    trackerJson<{ identity: string[] }>(`/api/v1/decks/${chosenTracker.id}`)
      .then((d) => setColors((c) => ({ ...c, [chosenTracker.id]: d.identity.join('') })))
      .catch(() => setColors((c) => ({ ...c, [chosenTracker.id]: '' })))
  }, [chosenTracker?.id])

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_OPPONENTS ? p : [...p, id]))
  const foes = picked.map((id) => roster.find((o) => o.id === id)).filter((o): o is CuratedOpponent => !!o)

  const deckName = chosenTracker?.name ?? chosenPrecon?.name ?? ''
  const deckColors = chosenTracker ? colors[chosenTracker.id] ?? '' : chosenPrecon?.colors ?? ''
  const canStart = connected && !starting && foes.length > 0 && (chosenTracker ? !!chosenTracker.commander : !!chosenPrecon)

  const start = async () => {
    if (!canStart) return
    setProblem('')
    setSince(useForge.getState().notices.reduce((m, n) => Math.max(m, n.id), 0))
    remember('forge.play.deck', mine ?? '')
    remember('forge.play.opponents', picked.join(','))
    let deck: { deck: string; deckList?: string; deckName?: string; trackerDeckId?: string } = { deck: mine ?? '' }
    if (chosenTracker) {
      setFetching(true)
      try {
        const ex = await trackerJson<{ text: string }>(`/api/v1/decks/${chosenTracker.id}/export/decklist`)
        deck = { deck: 'tracker', deckList: ex.text, deckName: chosenTracker.name, trackerDeckId: String(chosenTracker.id) }
      } catch {
        setProblem(`Couldn't read ${chosenTracker.name} from the tracker. Refresh and try again.`)
        return
      } finally {
        setFetching(false)
      }
    }
    if (send({ t: 'startMatch', format: 'commander', opponentIds: picked, ...deck })) setStarted(lobby)
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (useForge.getState().gameOver) return
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement)) void start()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const needle = q.toLowerCase()
  const shownPrecons = useMemo(
    () => precons.filter((d) => d.name.toLowerCase().includes(needle) || !!d.detail?.toLowerCase().includes(needle)),
    [precons, needle],
  )
  const games = lobby.games ?? []
  const states = lobby.states
  const who = tracker.state === 'ok' ? tracker.who : email

  return (
    <div className="tk" style={{ ['--tk-identity' as string]: stripeOf(deckColors) }}>
      <header className="tk-header">
        <nav>
          {fromTracker ? (
            <>
              <a className="tk-brand" href="/">mtgtracker</a>
              <a href="/">Overview</a>
              <a href="/decks">Decks</a>
              <a href="/cards">Cards</a>
              <a href="/printings">Printings</a>
              <a href="/transactions">Purchases</a>
              <a href="/people">Friends</a>
              <a href="./" aria-current="page">Play</a>
            </>
          ) : (
            <a className="tk-brand" href="./">Forge</a>
          )}
          {who && (fromTracker ? <a className="tk-who" href="/profile" title={email ?? undefined}>{who}</a> : <span className="tk-who">{who}</span>)}
          {!connected && <span className="tk-tag">offline</span>}
        </nav>
      </header>

      <main className="tk-main">
        <p className="tk-eyebrow">Commander · 40 life · commander damage at 21</p>
        <h1>Goldfish a deck</h1>
        <p className="tk-lede">Pick one of your decks and up to three opponents that each play one plan you'll recognise. The whole list plays, cards you still need to buy included.</p>

        <h2>
          Your deck
          <span className="tk-aside">
            {tracker.state === 'loading' ? 'Reading your decks…' : fromTracker ? `${trackerDecks.length} Commander deck${trackerDecks.length === 1 ? '' : 's'} on the tracker` : 'Forge precons (no tracker here)'}
          </span>
        </h2>
        {fromTracker && (
          <ul className="tk-rows" role="radiogroup" aria-label="Your deck">
            {trackerDecks.map((d) => {
              const id = `t:${d.id}`
              const on = id === mine
              const playable = !!d.commander
              return (
                <li key={d.id}>
                  <div role="radio" tabIndex={0} aria-checked={on} aria-disabled={!playable} className="tk-row"
                    style={on ? { ['--tk-row-accent' as string]: firstInk(colors[d.id] ?? '') } : undefined}
                    onClick={() => playable && setMine(id)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && playable && (e.preventDefault(), setMine(id))}>
                    <span className="tk-mark" aria-hidden>{on ? '●' : '○'}</span>
                    <span className="tk-name">{d.name}</span>
                    <span className="tk-right">
                      {on && colors[d.id] !== undefined && <Pips colors={colors[d.id]} />}
                      {d.counts.wanted > 0 && <span className="tk-tag" title="Cards on the list you don't own yet; they play anyway">{d.counts.wanted} to buy</span>}
                    </span>
                    <span className="tk-meta">
                      {playable ? <>{d.commander} · {d.counts.list} cards</> : <>No commander yet. <a href={`/decks/${d.id}`} onClick={(e) => e.stopPropagation()}>Pick one on the deck page</a></>}
                    </span>
                  </div>
                </li>
              )
            })}
            {trackerDecks.length === 0 && <li className="tk-subtle" style={{ padding: '12px 0' }}>No Commander decks yet. <a href="/decks">Add one on the tracker</a>.</li>}
          </ul>
        )}
        {tracker.state === 'none' && email && (
          // Hosted (an Access email) means the tracker should be here; say why it isn't rather than quietly falling back.
          <p className="tk-note" role="alert">
            {tracker.status === 401 || tracker.status === 403
              ? `You're signed in as ${email}, but you're not on the tracker yet. Ask its owner to add you; until then you can play a precon.`
              : `Couldn't read your decks from the tracker${tracker.status ? ` (HTTP ${tracker.status})` : ''}. You can play a precon meanwhile.`}
          </p>
        )}
        {tracker.state === 'none' && (
          <>
            <input className="tk-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search precons" aria-label="Search precons" />
            <ul className="tk-rows" role="radiogroup" aria-label="Your deck" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {shownPrecons.map((d) => {
                const on = d.id === mine
                return (
                  <li key={d.id}>
                    <div role="radio" tabIndex={0} aria-checked={on} className="tk-row" style={on ? { ['--tk-row-accent' as string]: firstInk(d.colors) } : undefined}
                      onClick={() => setMine(d.id)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), setMine(d.id))}>
                      <span className="tk-mark" aria-hidden>{on ? '●' : '○'}</span>
                      <span className="tk-name">{d.name}</span>
                      <span className="tk-right">{d.colors && <Pips colors={d.colors} />}</span>
                      {d.detail && <span className="tk-meta">{d.detail}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <h2>
          Opponents
          <span className="tk-aside">{foes.length} of {MAX_OPPONENTS} · {foes.length <= 1 ? 'one-on-one' : `free-for-all, ${foes.length + 1} players`}</span>
        </h2>
        <ul className="tk-rows" aria-label="Opponents">
          {roster.map((o) => {
            const on = picked.includes(o.id)
            const full = !on && picked.length >= MAX_OPPONENTS
            return (
              <li key={o.id}>
                <div role="button" tabIndex={0} aria-pressed={on} aria-disabled={full} className="tk-row"
                  style={{ ['--tk-row-accent' as string]: firstInk(o.colors) }}
                  title={full ? `Up to ${MAX_OPPONENTS} opponents` : undefined}
                  onClick={() => !full && toggle(o.id)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !full && (e.preventDefault(), toggle(o.id))}>
                  <span className="tk-mark" aria-hidden>{on ? '✓' : '+'}</span>
                  <span className="tk-name">
                    <span className="tk-label" style={{ display: 'block', color: firstInk(o.colors) }}>{o.archetype}</span>
                    {o.commander}
                  </span>
                  <span className="tk-right"><Pips colors={o.colors} /><span className="tk-tag" title="Forge AI profile">{o.profile}</span></span>
                  <span className="tk-meta">{o.plan} <span className="tk-subtle">· {o.deck}</span></span>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="tk-start">
          <div className="tk-matchup">
            {deckName || 'Choose a deck'}
            <small>{foes.length ? `vs ${foes.map((o) => o.commander.split(',')[0]).join(', ')}` : 'Pick at least one opponent'}</small>
          </div>
          <button type="button" className="tk-btn" disabled={!canStart} onClick={() => void start()}>
            {starting ? 'Starting…' : 'Start game'}
          </button>
        </div>
        {(problem || refusal) && <p className="tk-note" role="alert">{problem || refusal!.message}</p>}

        {games.length > 0 && (
          <>
            <h2>Recent games</h2>
            <table className="tk-table">
              <tbody>
                {games.map((g) => (
                  <tr key={g.id}>
                    <td className="tk-when">{when(g.endedAt ?? g.startedAt)}</td>
                    <td>{g.deckName} <span className="tk-subtle">vs</span> {g.opponentDeckName}</td>
                    <td>{result(g)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {states.length > 0 && (
          <details>
            <summary>Saved boards ({states.length})</summary>
            <div className="tk-boards">
              {states.map((s) => (
                <button key={s} type="button" className="tk-link-btn" disabled={!connected || starting}
                  onClick={() => send({ t: 'startState', state: s }) && setStarted(lobby)}>
                  {s.replace(/\.txt$/, '')}
                </button>
              ))}
            </div>
          </details>
        )}
      </main>
    </div>
  )
}
