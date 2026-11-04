import { useLayoutEffect, useState } from 'react'
import { PeekRoot } from '../popover/PeekRoot'
import { useForge } from '../store'
import { FIXTURES } from './fixtures'
import { MatchTable } from './MatchTable'
import { PromptBar } from '../shell/PromptBar'

// &hand=N swaps your hand for N cards (copies of its first card), every third one playable.
function bigHand(s: ReturnType<typeof useForge.getState>, n: number) {
  const meId = s.game!.localPlayerIds[0]
  const me = s.players[meId]
  const model = s.cards[me.zones.hand[0]]
  if (!model) return {}
  const cards = { ...s.cards }
  const ids = Array.from({ length: n }, (_, i) => {
    const id = 900000 + i
    cards[id] = { ...model, id, name: `Hand Card ${i + 1}`, manaCost: `{${i % 8}}` }
    return id
  })
  return { cards, players: { ...s.players, [meId]: { ...me, handCount: n, zones: { ...me.zones, hand: ids } } }, playable: new Set(ids.filter((_, i) => i % 3 === 0)) }
}

// /?preview renders the table from fixture data, no server needed. ?preview=pod picks a fixture.
export function BoardPreview() {
  const initial = new URLSearchParams(location.search).get('preview')
  const [id, setId] = useState(FIXTURES.some((f) => f.id === initial) ? initial! : FIXTURES[0].id)
  const [loaded, setLoaded] = useState<string | null>(null)
  useLayoutEffect(() => {
    ;(window as unknown as { forge: typeof useForge }).forge = useForge // for poking at the store from devtools
    const f = FIXTURES.find((x) => x.id === id)!
    useForge.setState({ inMatch: true, connected: false, ask: null, reveal: null, notices: [], gameOver: null, ...f.state() })
    const n = Number(new URLSearchParams(location.search).get('hand'))
    if (n > 0) useForge.setState(bigHand(useForge.getState(), n))
    setLoaded(id)
    const url = new URL(location.href)
    url.searchParams.set('preview', id)
    history.replaceState(null, '', url)
  }, [id])
  if (!loaded) return null
  return (
    <div className="relative h-full">
      <MatchTable key={loaded} centerSlot={<PromptBar />} />
      <PeekRoot />
      <div className="absolute bottom-2 right-2 z-[60] flex gap-0.5 rounded-full border border-line bg-panel/95 p-0.5 text-[11px] shadow-lg">
        {FIXTURES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setId(f.id)}
            className={`rounded-full px-2.5 py-0.5 transition ${f.id === id ? 'bg-accent font-semibold text-table' : 'text-ink-dim hover:text-ink'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}
