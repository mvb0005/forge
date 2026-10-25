import { useLayoutEffect, useState } from 'react'
import { useForge } from '../store'
import { FIXTURES } from './fixtures'
import { MatchTable } from './MatchTable'

// /?preview renders the table from fixture data, no server needed. ?preview=pod picks a fixture.
export function BoardPreview() {
  const initial = new URLSearchParams(location.search).get('preview')
  const [id, setId] = useState(FIXTURES.some((f) => f.id === initial) ? initial! : FIXTURES[0].id)
  const [loaded, setLoaded] = useState<string | null>(null)
  useLayoutEffect(() => {
    ;(window as unknown as { forge: typeof useForge }).forge = useForge // for poking at the store from devtools
    const f = FIXTURES.find((x) => x.id === id)!
    useForge.setState({ inMatch: true, connected: false, hoveredCardId: null, ask: null, reveal: null, notices: [], gameOver: null, ...f.state() })
    setLoaded(id)
    const url = new URL(location.href)
    url.searchParams.set('preview', id)
    history.replaceState(null, '', url)
  }, [id])
  if (!loaded) return null
  return (
    <div className="relative h-full">
      <MatchTable key={loaded} centerSlot={<PreviewPrompt />} />
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

// Stand-in for the shell's prompt bar so the centre strip looks real in preview.
function PreviewPrompt() {
  const prompt = useForge((s) => s.prompt)
  const buttons = useForge((s) => s.buttons)
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="truncate text-sm text-ink">{prompt?.message}</span>
      {buttons && (
        <div className="flex shrink-0 gap-1.5">
          <button type="button" disabled={!buttons.cancel.enabled} className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm text-ink disabled:opacity-35">
            {buttons.cancel.label}
          </button>
          <button type="button" disabled={!buttons.ok.enabled} className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-table disabled:opacity-35">
            {buttons.ok.label}
          </button>
        </div>
      )}
    </div>
  )
}
