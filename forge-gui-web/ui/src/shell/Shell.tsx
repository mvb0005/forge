import { useEffect, useState, type ReactNode } from 'react'
import { setSocket } from '../net'
import type { ServerMessage } from '../protocol'
import { useForge } from '../store'
import { GameOverModal, Toasts } from './Global'
import { Lobby } from './Lobby'

type Link = 'connecting' | 'open' | 'retrying'

// Owns the WebSocket: connect, feed the store, reconnect with backoff.
function useConnection() {
  const [link, setLink] = useState<Link>('connecting')
  const [retryIn, setRetryIn] = useState(0)
  useEffect(() => {
    let disposed = false
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 500
    const { apply, setConnected, clearAsk } = useForge.getState()

    const connect = () => {
      if (disposed) return
      setLink('connecting')
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      ws.onopen = () => {
        if (disposed) return
        delay = 500
        setSocket(ws)
        setConnected(true)
        setLink('open')
      }
      ws.onmessage = (e) => {
        if (disposed) return
        let m: ServerMessage
        try {
          m = JSON.parse(e.data)
        } catch {
          console.warn('bad frame', e.data)
          return
        }
        try {
          apply(m)
          if (m.t === 'lobby') {
            // the match is gone; drop anything left from it
            clearAsk()
            useForge.getState().clearReveal()
          }
        } catch (err) {
          console.error('failed to apply', m, err)
        }
      }
      ws.onclose = () => {
        if (disposed) return
        setSocket(null)
        setConnected(false)
        clearAsk() // the server re-sends the open ask after reconnecting
        setLink('retrying')
        setRetryIn(delay)
        timer = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 8000)
      }
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(timer)
      setSocket(null)
      ws?.close()
    }
  }, [])
  return { link, retryIn }
}

export function Shell({ match }: { match: ReactNode }) {
  const { link, retryIn } = useConnection()
  const inMatch = useForge((s) => s.inMatch)
  const lobby = useForge((s) => s.lobby)
  return (
    <>
      {inMatch ? <div className="fixed inset-0">{match}</div> : lobby ? <Lobby /> : <Splash link={link} />}
      {link !== 'open' && (inMatch || lobby) && <LinkBadge link={link} retryIn={retryIn} />}
      <Toasts />
      <GameOverModal />
    </>
  )
}

function LinkBadge({ link, retryIn }: { link: Link; retryIn: number }) {
  return (
    <div className="shell-in fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-danger/50 bg-panel px-4 py-1.5 text-xs shadow-lg">
      <span className={`h-2 w-2 rounded-full ${link === 'connecting' ? 'animate-pulse bg-target' : 'bg-danger'}`} />
      {link === 'connecting' ? 'Reconnecting…' : `Disconnected · retrying in ${Math.round(retryIn / 100) / 10}s`}
    </div>
  )
}

function Splash({ link }: { link: Link }) {
  return (
    <div className="grid h-full place-items-center" style={{ background: 'radial-gradient(ellipse 80% 60% at 30% 0%, #2a2118 0%, #120e0a 55%, #0a0806 100%)' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="font-title text-4xl font-bold">Forge</div>
        <div className="flex items-center gap-2 text-sm text-ink-dim">
          <span className={`h-2 w-2 rounded-full ${link === 'retrying' ? 'bg-danger' : 'animate-pulse bg-accent'}`} />
          {link === 'retrying' ? 'Server unreachable, retrying…' : 'Connecting to server…'}
        </div>
      </div>
    </div>
  )
}
