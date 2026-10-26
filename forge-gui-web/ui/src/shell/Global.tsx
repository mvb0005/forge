import { useEffect } from 'react'
import { useForge } from '../store'
import { Btn, IconBtn } from './ui'

const NONE: number[] = []
const toastLife = { info: 4000, flash: 2500, error: 9000 }
const toastTone = { info: 'border-line', flash: 'border-target/60', error: 'border-danger/70' }

function Toast({ n }: { n: { id: number; level: 'info' | 'error' | 'flash'; title: string; message: string } }) {
  const dismiss = useForge((s) => s.dismissNotice)
  useEffect(() => {
    const t = setTimeout(() => dismiss(n.id), toastLife[n.level])
    return () => clearTimeout(t)
  }, [n.id, n.level, dismiss])
  return (
    <div className={`shell-in pointer-events-auto flex items-start gap-3 rounded-xl border bg-panel/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur ${toastTone[n.level]}`}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.level === 'error' ? 'bg-danger' : n.level === 'flash' ? 'bg-target' : 'bg-accent'}`} />
      <div className="min-w-0 flex-1">
        {n.title && <div className="text-sm font-medium">{n.title}</div>}
        {n.message && <div className="whitespace-pre-line text-sm text-ink-dim">{n.message}</div>}
      </div>
      <IconBtn title="Dismiss" onClick={() => dismiss(n.id)}>×</IconBtn>
    </div>
  )
}

export function Toasts() {
  const notices = useForge((s) => s.notices)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {notices.slice(-4).map((n) => <Toast key={n.id} n={n} />)}
    </div>
  )
}

export function GameOverModal() {
  const over = useForge((s) => s.gameOver)
  const local = useForge((s) => s.game?.localPlayerIds ?? NONE)
  const players = useForge((s) => s.players)
  const close = useForge((s) => s.clearGameOver)
  useEffect(() => {
    if (!over) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') close()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [over, close])
  if (!over) return null
  const won = over.winner != null && local.some((id) => players[id]?.name === over.winner)
  const headline = over.winner == null ? 'Draw' : won ? 'Victory' : 'Defeat'
  return (
    <div className="shell-fade fixed inset-0 z-50 grid place-items-center bg-table/70 p-6 backdrop-blur-sm">
      <div className="shell-in w-full max-w-md lk-plate rounded-2xl p-8 text-center">
        <div className={`font-title text-5xl font-bold ${over.winner == null ? 'text-ink' : won ? 'text-playable' : 'text-danger'}`}>{headline}</div>
        <div className="mt-2 text-sm text-ink-dim">{won ? 'You won the game' : over.winner ? `${over.winner} wins the game` : 'Nobody won'}</div>
        {over.summary && <p className="mt-5 whitespace-pre-line rounded-lg bg-felt px-4 py-3 text-left text-sm text-ink-dim">{over.summary}</p>}
        <Btn variant="primary" className="mt-6 w-full py-2.5" autoFocus onClick={close}>Back to lobby</Btn>
      </div>
    </div>
  )
}
