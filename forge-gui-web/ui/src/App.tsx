import { MatchTable } from './board/MatchTable'
import { BoardPreview } from './board/BoardPreview'
import { Shell } from './shell/Shell'
import { PromptBar } from './shell/PromptBar'
import { Overlays } from './shell/Overlays'
import { ErrorBoundary } from './ErrorBoundary'
import { useForge } from './store'
import { lazy, Suspense } from 'react'
import { PeekRoot } from './popover/PeekRoot'

const Bench = lazy(() => import('./bench/Bench').then((m) => ({ default: m.Bench })))

const DevDialogs = import.meta.env.DEV ? lazy(() => import('./shell/DevDialogs').then((m) => ({ default: m.DevDialogs }))) : null
const DevPeek = import.meta.env.DEV ? lazy(() => import('./popover/DevPeek').then((m) => ({ default: m.DevPeek }))) : null
const DevLook = import.meta.env.DEV ? lazy(() => import('./look/DevLook').then((m) => ({ default: m.DevLook }))) : null

export default function App() {
  const q = new URLSearchParams(location.search)
  if (q.has('preview')) return <BoardPreview />
  if (q.has('bench')) return <Suspense><Bench /></Suspense>
  if (DevDialogs && q.has('dialogs')) return <Suspense><DevDialogs /></Suspense>
  if (DevPeek && q.has('peek')) return <Suspense><DevPeek /></Suspense>
  if (DevLook && q.has('look')) return <Suspense><DevLook /></Suspense>
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
      <PeekRoot />
      <Overlays />
    </>
  )
}
