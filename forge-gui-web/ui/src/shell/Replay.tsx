import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { MatchTable } from '../board/MatchTable'
import { useBoardUi } from '../board/uiStore'
import { stepWords } from '../look/phase'
import { setSendTap } from '../net'
import { PeekRoot } from '../popover/PeekRoot'
import { advanceReplay, replaySource, beatMs, indexReplay, readReplay, seekReplay, stopAtSeq, type Replay, type ReplayIndex } from '../replay'
import { useForge } from '../store'
import { ErrorBoundary } from '../ErrorBoundary'
import { GameOverModal, Toasts } from './Global'
import { AskHost, RevealPanel } from './Overlays'
import { PromptBar } from './PromptBar'
import '@fontsource/spectral/latin-700.css'
import './landing.css'

// /?replay watches a seat's replay (docs/REPLAYS.md): ?replay=<url> fetches one (the tracker's
// /play/games/<match>/replay/<seat>), bare ?replay asks for a file. &at=<seq> opens that moment.
// The table is the live one with nothing sent anywhere.

const SPEEDS = [1, 2, 4, 8]
const initial = useForge.getState()

type Loaded = { replay: Replay; idx: ReplayIndex }

async function load(data: ArrayBuffer): Promise<Loaded> {
  const replay = await readReplay(data)
  return { replay, idx: indexReplay(replay, initial) }
}

export function ReplayPage() {
  const src = replaySource(location.pathname, new URLSearchParams(location.search))
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setSendTap(() => {})
    useBoardUi.setState({ replaying: true })
    return () => {
      setSendTap(null)
      useBoardUi.setState({ replaying: false })
    }
  }, [])
  useEffect(() => {
    if (!src) return
    fetch(src, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.arrayBuffer()
      })
      .then(load)
      .then(setLoaded, (e) => setError(`Couldn't load the replay: ${e.message ?? e}`))
  }, [src])
  const open = (f: File | undefined) => {
    if (!f) return
    setError(null)
    f.arrayBuffer().then(load).then(setLoaded, (e) => setError(`Couldn't read ${f.name}: ${e.message ?? e}`))
  }
  if (loaded) return <ReplayTable {...loaded} />
  return <Picker loading={!!src && !error} error={error} onFile={open} />
}

function Picker({ loading, error, onFile }: { loading: boolean; error: string | null; onFile: (f: File | undefined) => void }) {
  const drop = (e: DragEvent) => {
    e.preventDefault()
    onFile(e.dataTransfer.files[0])
  }
  return (
    <div className="tk" onDragOver={(e) => e.preventDefault()} onDrop={drop}>
      <div className="tk-center">
        <div>
          <h1>Replay</h1>
          {loading ? <p>Loading the replay…</p> : (
            <>
              <p>Open a replay file (<code>forge-replay-…jsonl.gz</code>, from the tracker's game history), or drop it here.</p>
              <p style={{ marginTop: 16 }}><input type="file" accept=".gz,.jsonl,application/gzip" onChange={(e) => onFile(e.target.files?.[0])} /></p>
            </>
          )}
          {error && <p style={{ marginTop: 16 }}>{error}</p>}
        </div>
      </div>
    </div>
  )
}

function startStop(idx: ReplayIndex) {
  const at = Number(new URLSearchParams(location.search).get('at'))
  return at > 0 ? stopAtSeq(idx, at) : 0
}

function ReplayTable({ replay, idx }: Loaded) {
  const [stop, setStop] = useState(() => startStop(idx))
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)
  const [skip, setSkip] = useState(true) // skip quiet steps when stepping and playing
  const shown = useRef(-1)
  // Moving a little forward applies just the messages between, so the table animates as it did live; anything
  // else seeks from a keyframe.
  useLayoutEffect(() => {
    const from = shown.current
    if (from >= 0 && stop > from && idx.stops[stop].pos - idx.stops[from].pos < 200) advanceReplay(replay, idx.stops[from].pos, idx.stops[stop].pos)
    else seekReplay(replay, idx, idx.stops[stop].pos)
    shown.current = stop
    const url = new URL(location.href)
    url.searchParams.set('at', String(idx.stops[stop].seq))
    history.replaceState(null, '', url)
  }, [replay, idx, stop])
  const last = idx.stops.length - 1
  const quiet = useCallback((i: number) => skip && i > 0 && i < last && idx.stops[i].quiet, [skip, idx, last])
  useEffect(() => {
    if (!playing) return
    if (stop >= last) {
      setPlaying(false)
      return
    }
    let next = stop + 1
    while (quiet(next)) next++
    const t = setTimeout(() => setStop(Math.min(next, last)), beatMs(idx, stop, speed))
    return () => clearTimeout(t)
  }, [playing, stop, speed, idx, last, quiet])

  const go = useCallback((s: number) => setStop(Math.max(0, Math.min(last, s))), [last])
  // To the first stop of the next turn or step; back, to the start of this one, or of the one before when already there.
  // Quiet steps are passed over.
  const jump = useCallback((dir: 1 | -1, same: (a: number, b: number) => boolean) => {
    if (dir > 0) {
      let i = stop + 1
      while (i <= last && same(i, stop)) i++
      while (quiet(i)) i++
      go(i)
      return
    }
    let j = stop
    while (j > 0 && same(j - 1, j)) j--
    while (j > 0 && (j === stop || quiet(j))) {
      j--
      while (j > 0 && same(j - 1, j)) j--
    }
    go(j)
  }, [stop, last, go, quiet])
  const sameTurn = useCallback((a: number, b: number) => idx.stops[a].turn === idx.stops[b].turn, [idx])
  const samePhase = useCallback((a: number, b: number) => sameTurn(a, b) && idx.stops[a].phase === idx.stops[b].phase, [idx, sameTurn])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && e.key !== ' ') return
      const handled = () => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (e.key === ' ') {
        handled()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        handled()
        const dir = e.key === 'ArrowRight' ? 1 : -1
        jump(dir, e.shiftKey ? sameTurn : samePhase)
      } else if (e.key === '.' || e.key === ',') {
        handled()
        go(stop + (e.key === '.' ? 1 : -1))
      }
    }
    window.addEventListener('keydown', h, true) // capture: before the table's own Space and arrows
    return () => window.removeEventListener('keydown', h, true)
  }, [stop, go, jump, sameTurn, samePhase])

  return (
    <div className="fixed inset-0">
      <ErrorBoundary>
        <MatchTable centerSlot={<PromptBar />} />
      </ErrorBoundary>
      <PeekRoot />
      <RevealPanel />
      <AskHost />
      <Toasts />
      <GameOverModal />
      <ReplayBar replay={replay} idx={idx} stop={stop} playing={playing} speed={speed} skip={skip} onSkip={() => setSkip((x) => !x)}
        onStop={go} onPlay={() => setPlaying((p) => !p)} onSpeed={setSpeed}
        onTurn={(d) => jump(d, sameTurn)} onPhase={(d) => jump(d, samePhase)} />
    </div>
  )
}

/** The views a game's replay page may switch to: everyone and each seat for a game with one replay (the tracker
 * projects each), else the human seats' own files. A local file has only its own. */
function perspectives(h: Replay['header']): { seat: number; label: string }[] {
  if (!/\/play\/table\/[0-9a-f]{16}\/replay\//.test(location.pathname)) return []
  const seats = h.seats.filter((s) => h.perspectives || s.kind === 'human').map((s) => ({ seat: s.index, label: `${s.name}'s view${s.kind === 'ai' ? ' (AI)' : ''}` }))
  return h.perspectives ? [{ seat: -1, label: "Everyone's view" }, ...seats] : seats
}

/** Reopens the page as another view, at the same moment (seq is the same in every view of a game). */
function watchAs(seat: number) {
  const url = new URL(location.href)
  if (seat < 0) url.searchParams.delete('seat')
  else url.searchParams.set('seat', String(seat))
  location.assign(url)
}

/** Play from here (docs/REPLAYS.md D-R8): the tracker starts a new game on the board saved at this turn's first
 * main phase, this seat yours and AIs the others, and answers the new table's address. */
async function playFrom(matchId: string, turn: number, seat: number): Promise<string> {
  const res = await fetch(`/play/games/${matchId}/replay/play`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turn, seat }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.url) throw new Error(body.error?.message ?? body.detail ?? `${res.status} ${res.statusText}`)
  return body.url
}

function ReplayBar({ replay, idx, stop, playing, speed, skip, onSkip, onStop, onPlay, onSpeed, onTurn, onPhase }: {
  replay: Replay; idx: ReplayIndex; stop: number; playing: boolean; speed: number; skip: boolean; onSkip: () => void
  onStop: (s: number) => void; onPlay: () => void; onSpeed: (s: number) => void; onTurn: (d: 1 | -1) => void; onPhase: (d: 1 | -1) => void
}) {
  const s = idx.stops[stop]
  const last = idx.stops.length - 1
  const [copied, setCopied] = useState(false)
  const turnTicks: { stop: number; turn: number }[] = []
  idx.stops.forEach((x, i) => {
    if (i === 0 || x.turn !== idx.stops[i - 1].turn) turnTicks.push({ stop: i, turn: x.turn })
  })
  const copy = () => {
    void navigator.clipboard?.writeText(location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const h = replay.header
  const views = perspectives(h)
  const [starting, setStarting] = useState<string | null>(null)
  const canPlayOn = views.length > 0 && !!h.boards?.includes(s.turn)
  const playOn = () => {
    setStarting('Starting…')
    playFrom(h.matchId, s.turn, h.seat).then((url) => location.assign(url), (e) => setStarting(`Couldn't start: ${e.message ?? e}`))
  }
  const btn = 'rounded-md px-2 py-1 text-ink-dim hover:bg-panel-2 hover:text-ink'
  return (
    <div className="lk-plate fixed left-1/2 top-2 z-[70] flex w-[min(880px,calc(100vw-120px))] -translate-x-1/2 flex-col gap-1 rounded-xl px-3 py-2 text-xs shadow-2xl" style={{ color: 'var(--lk-parchment)' }}>
      <div className="flex items-center gap-1">
        {views.length > 1 ? (
          <select className="rounded-md bg-panel-2 px-1 py-0.5 font-title font-bold text-ink" title="Whose view: the server sends only what that seat saw"
            value={h.seat} onChange={(e) => watchAs(Number(e.target.value))} aria-label="Whose view">
            {views.map((v) => <option key={v.seat} value={v.seat}>{v.label}</option>)}
          </select>
        ) : (
          <span className="whitespace-nowrap font-title font-bold" title={`Match ${h.matchId}, seat ${h.seat}`}>Replay · {h.who}'s view</span>
        )}
        <span className="ml-2 truncate text-ink-dim">Turn {s.turn} · {stepWords(s.phase) || '—'} · seq {s.seq}</span>
        <span className="ml-auto" />
        <button type="button" className={btn} title="Previous turn (Shift+←)" onClick={() => onTurn(-1)}>⏮</button>
        <button type="button" className={btn} title="Previous step (←)" onClick={() => onPhase(-1)}>«</button>
        <button type="button" className={btn} title="Back one update (,)" onClick={() => onStop(stop - 1)}>‹</button>
        <button type="button" className={`${btn} w-14 font-bold text-ink`} title="Play or pause (Space)" onClick={onPlay}>{playing ? 'Pause' : 'Play'}</button>
        <button type="button" className={btn} title="Forward one update (.)" onClick={() => onStop(stop + 1)}>›</button>
        <button type="button" className={btn} title="Next step (→)" onClick={() => onPhase(1)}>»</button>
        <button type="button" className={btn} title="Next turn (Shift+→)" onClick={() => onTurn(1)}>⏭</button>
        <span className="mx-1 h-4 w-px bg-line" />
        {SPEEDS.map((x) => (
          <button key={x} type="button" className={`${btn} ${x === speed ? 'bg-panel-2 text-ink' : ''}`} onClick={() => onSpeed(x)}>{x}×</button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <button type="button" className={`${btn} whitespace-nowrap ${skip ? 'bg-panel-2 text-ink' : ''}`} onClick={onSkip}
          title="Step and play past steps where nothing happened">Skip quiet</button>
        <button type="button" className={btn} title="Copy a link to this moment" onClick={copy}>{copied ? 'Copied' : 'Link'}</button>
        {canPlayOn && (
          <button type="button" className={`${btn} whitespace-nowrap`} onClick={playOn} disabled={starting === 'Starting…'}
            title={`A new game on turn ${s.turn}'s board, from its first main phase: you play ${h.seat < 0 ? 'the first human seat' : `${h.who}'s seat`}, AIs the others`}>
            {starting ?? 'Play from here'}
          </button>
        )}
      </div>
      <div className="relative h-5">
        <input type="range" min={0} max={last} value={stop} onChange={(e) => onStop(Number(e.target.value))}
          className="absolute inset-x-0 top-0 w-full accent-[var(--lk-gold,#c9a45c)]" aria-label="Position" />
        {turnTicks.map((t) => (
          <span key={t.stop} title={`Turn ${t.turn}`} onClick={() => onStop(t.stop)}
            className="absolute bottom-0 h-1.5 w-px cursor-pointer bg-ink-dim/60"
            style={{ left: `${(t.stop / Math.max(1, last)) * 100}%` }} />
        ))}
      </div>
    </div>
  )
}
