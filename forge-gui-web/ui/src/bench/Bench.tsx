import { useEffect, useLayoutEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { FIXTURES } from '../board/fixtures'
import { commanderBoard } from '../board/fixtures/commander'
import { MatchTable } from '../board/MatchTable'
import type { CardDto, CombatDto } from '../protocol'
import type { ForgeState } from '../store'
import { useForge } from '../store'
import { FLIP_MS } from '../table/CardLayer'

// /?bench=pod|commander: client performance budgets (docs/PLAN.md) on a fixture board. Run it on a
// production build (vite build && vite preview) in a foreground tab. Results land in the page and
// on window.__bench.

type Board = { state: Partial<ForgeState>; attack: CombatDto | null; probe: string; token: string }

function board(id: string): Board {
  if (id === 'pod') {
    const state = FIXTURES.find((f) => f.id === 'pod')!.state()
    return { state: { ...state, combat: null }, attack: state.combat ?? null, probe: 'Tarmogoyf', token: 'Spirit' }
  }
  const { attack, ...state } = commanderBoard()
  return { state, attack, probe: 'Creature 1-1', token: 'Soldier' }
}

const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
let seq = 1

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { n: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) }
}

// One state message upserting one card; the time to apply it and render (React commit, then style
// and layout forced by a read). Paint is not included.
async function oneCard(find: () => CardDto | undefined, n: number) {
  const commit: number[] = []
  const total: number[] = []
  const layer = document.querySelector('[data-card-layer]') as HTMLElement
  for (let i = 0; i < n + 20; i++) {
    const c = find()!
    const m = { t: 'state' as const, seq: seq++, full: false, cards: [{ ...c, power: (c.power ?? 0) + (i % 2 ? -1 : 1) }] }
    await frame()
    const t0 = performance.now()
    flushSync(() => useForge.getState().apply(m))
    const t1 = performance.now()
    void layer.offsetHeight
    const t2 = performance.now()
    if (i >= 20) {
      commit.push(t1 - t0)
      total.push(t2 - t0)
    }
  }
  return { commit: stats(commit), withStyleLayout: stats(total) }
}

// Counts layout reads (getBoundingClientRect, offset*, client*) while the table animates.
function countLayoutReads() {
  let n = 0
  const restore: (() => void)[] = []
  const wrap = (proto: object, key: string) => {
    const d = Object.getOwnPropertyDescriptor(proto, key)!
    if (d.get) {
      const get = d.get
      Object.defineProperty(proto, key, { ...d, get() { n++; return get.call(this) } })
    } else {
      const fn = d.value
      Object.defineProperty(proto, key, { ...d, value(...a: unknown[]) { n++; return fn.apply(this, a) } })
    }
    restore.push(() => Object.defineProperty(proto, key, d))
  }
  wrap(Element.prototype, 'getBoundingClientRect')
  for (const k of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']) wrap(HTMLElement.prototype, k)
  for (const k of ['clientWidth', 'clientHeight']) wrap(Element.prototype, k)
  return () => {
    restore.forEach((r) => r())
    return n
  }
}

// Main <-> combat: the trigger (layout + commit), the time until the next frame (the trigger plus
// style, layout and paint of the commit) and the frames of the animation that follows.
async function phase(attack: CombatDto | null, rounds: number) {
  const trigger: number[] = []
  const frames: number[] = []
  const first: number[] = [] // trigger to the next frame: commit, style, layout and paint of the new placements
  let reads = 0
  for (let i = 0; i < rounds; i++) {
    const combat = i % 2 === 0 ? attack : null
    await wait(400)
    await frame()
    const t0 = performance.now()
    flushSync(() => useForge.getState().apply({ t: 'state', seq: seq++, full: false, combat }))
    trigger.push(performance.now() - t0)
    const stop = countLayoutReads()
    let last = await frame()
    first.push(last - t0)
    const end = last + FLIP_MS
    while (last < end) {
      const t = await frame()
      frames.push(t - last)
      last = t
    }
    reads += stop()
  }
  const slow = frames.filter((f) => f > 1000 / 60 + 1.5).length
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length
  return { trigger: stats(trigger), firstFrame: stats(first), frames: { ...stats(frames), over16_7ms: slow, avgFps: +(1000 / avg).toFixed(1) }, layoutReadsDuringAnimation: reads }
}

export function Bench() {
  const id = new URLSearchParams(location.search).get('bench') || 'commander'
  const [b] = useState(() => board(id))
  const [ready, setReady] = useState(false)
  const [out, setOut] = useState('running…')
  useLayoutEffect(() => {
    ;(window as unknown as { __forge: typeof useForge }).__forge = useForge // for poking at the bench from devtools
    useForge.setState({ inMatch: true, connected: false, ask: null, reveal: null, notices: [], gameOver: null, ...b.state })
    setReady(true)
  }, [b])
  useEffect(() => {
    if (!ready) return
    let alive = true
    ;(async () => {
      await wait(800)
      const s = useForge.getState()
      const permanents = Object.values(s.players).reduce((n, p) => n + p.zones.battlefield.length, 0)
      const elements = document.querySelectorAll('[data-card-layer] > [data-entity]').length
      const byName = (name: string) => () => Object.values(useForge.getState().cards).find((c) => c.name === name && c.zone === 'battlefield' && c.controllerId === 1)
      const singleton = await oneCard(byName(b.probe), 200)
      const grouped = await oneCard(byName(b.token), 100)
      const transition = await phase(b.attack, 8)
      flushSync(() => useForge.getState().apply({ t: 'state', seq: seq++, full: false, combat: b.attack }))
      await wait(400)
      const inCombat = await oneCard(byName(b.probe), 100)
      const res = { board: id, permanents, elements, build: import.meta.env.PROD ? 'production' : 'dev', oneCard: singleton, oneCardInGroup: grouped, oneCardInCombat: inCombat, phaseTransition: transition }
      ;(window as unknown as { __bench: unknown }).__bench = res
      if (alive) setOut(JSON.stringify(res, null, 2))
    })()
    return () => {
      alive = false
    }
  }, [ready, b, id])
  if (!ready) return null
  return (
    <div className="relative h-full">
      <MatchTable centerSlot={null} />
      <pre data-bench className="absolute left-2 top-2 z-[100] max-h-[90%] overflow-auto rounded-lg bg-black/85 p-3 text-[11px] text-ink">{out}</pre>
    </div>
  )
}
