import { MatchTable } from './board/MatchTable'
import { BoardPreview } from './board/BoardPreview'
import { Shell } from './shell/Shell'
import { PromptBar } from './shell/PromptBar'
import { Overlays } from './shell/Overlays'
import { ErrorBoundary } from './ErrorBoundary'
import { useForge } from './store'
import { lazy, Suspense } from 'react'

const DevDialogs = import.meta.env.DEV ? lazy(() => import('./shell/DevDialogs').then((m) => ({ default: m.DevDialogs }))) : null

export default function App() {
  const q = new URLSearchParams(location.search)
  if (q.has('preview')) return <BoardPreview />
  if (DevDialogs && q.has('dialogs')) return <Suspense><DevDialogs /></Suspense>
  return <Shell match={<Match />} />
}

function Match() {
  const inMatch = useForge((s) => s.inMatch)
  if (!inMatch) return null
  return (
    <>
      <ErrorBoundary>
        <MatchTable centerSlot={<PromptBar />} />
      </ErrorBoundary>
      <Overlays />
    </>
  )
}
