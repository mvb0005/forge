import { useEffect, useState, type ReactNode } from 'react'
import { setSocket } from '../net'
import type { ServerMessage } from '../protocol'
import { useForge } from '../store'
import { GameOverModal, Toasts } from './Global'
import { Lobby } from './Lobby'

type Link = 'connecting' | 'open' | 'retrying' | 'taken' | 'replaced' | 'signedOut'

const SEAT_KEY = 'forge.seat'
const SEAT_TAKEN = 4000
const SEAT_REPLACED = 4001
const SIGN_IN = 4003

function seatToken() {
  try {
    return sessionStorage.getItem(SEAT_KEY)
  } catch {
    return null
  }
}

function rememberSeat(token: string) {
  try {
    sessionStorage.setItem(SEAT_KEY, token)
  } catch {
    /* storage unavailable */
  }
}

// Owns the WebSocket: connect, feed the store, reconnect with backoff.
function useConnection() {
  const [link, setLink] = useState<Link>('connecting')
  const [retryIn, setRetryIn] = useState(0)
  const [note, setNote] = useState('')
  useEffect(() => {
    let disposed = false
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 500
    let takenTries = 0
    const { apply, setConnected, clearAsk } = useForge.getState()

    const connect = () => {
      if (disposed) return
      setLink('connecting')
      const prefix = location.pathname === '/play' || location.pathname.startsWith('/play/') ? '/play' : ''
      const token = seatToken()
      const query = token ? `?seat=${encodeURIComponent(token)}` : ''
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${prefix}/ws${query}`)
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
        if (m.t === 'hello' && m.seat) rememberSeat(m.seat)
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
      ws.onclose = (ev) => {
        if (disposed) return
        setSocket(null)
        setConnected(false)
        clearAsk() // the server re-sends the open ask after reconnecting
        setNote(ev.reason)
        if (ev.code === SIGN_IN) {
          setLink('signedOut')
          return
        }
        if (ev.code === SEAT_REPLACED) {
          setLink('replaced')
          return
        }
        // A refresh closes the old socket as the new page connects, so the first tries can still see the seat held.
        const refreshRace = ev.reason === 'This seat is open in another window'
        if (ev.code === SEAT_TAKEN && refreshRace && takenTries < 5) {
          takenTries += 1
          setLink('connecting')
          timer = setTimeout(connect, 300)
          return
        }
        if (ev.code === SEAT_TAKEN) {
          setLink('taken')
          return
        }
        takenTries = 0
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
  return { link, retryIn, note }
}

export function Shell({ match }: { match: ReactNode }) {
  const { link, retryIn, note } = useConnection()
  const inMatch = useForge((s) => s.inMatch)
  const lobby = useForge((s) => s.lobby)
  const closed = link === 'taken' || link === 'replaced' || link === 'signedOut'
  return (
    <>
      {closed ? <SeatClosed link={link} note={note} />
        : inMatch ? <div className="fixed inset-0">{match}</div>
        : lobby ? <Lobby />
        : <Splash link={link} />}
      {link !== 'open' && !closed && (inMatch || lobby) && <LinkBadge link={link} retryIn={retryIn} />}
      <Toasts />
      <GameOverModal />
    </>
  )
}

function SeatClosed({ link, note }: { link: 'taken' | 'replaced' | 'signedOut'; note: string }) {
  const title = link === 'replaced' ? 'Reconnected elsewhere' : link === 'signedOut' ? 'Sign in' : 'Seat is taken'
  const fallback = link === 'replaced'
    ? 'This window was closed because the seat opened another connection. One window plays at a time.'
    : link === 'signedOut'
      ? 'Sign in through Cloudflare Access, then refresh.'
      : 'Someone already has this seat open. Close that window, then refresh this one.'
  return (
    <div className="grid h-full place-items-center" style={{ background: 'radial-gradient(ellipse 80% 60% at 30% 0%, #2a2118 0%, #120e0a 55%, #0a0806 100%)' }}>
      <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
        <div className="font-title text-3xl font-bold">{title}</div>
        <p className="text-sm text-ink-dim">{note || fallback}</p>
      </div>
    </div>
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
