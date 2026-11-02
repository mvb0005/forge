import { useEffect, useState, type ReactNode } from 'react'
import { goBack, inLobby, listenForVoice } from '../discord'
import { setSocket } from '../net'
import type { ServerMessage } from '../protocol'
import { useForge } from '../store'
import { GameOverModal, Toasts } from './Global'
import '@fontsource/spectral/latin-700.css'
import './landing.css'

type Link = 'connecting' | 'open' | 'retrying' | 'noSeat' | 'replaced' | 'over'

const SEAT_REPLACED = 4001
const NO_SEAT = 4004

/**
 * The seat ticket the tracker put on the link (?ticket=). Kept for this tab and this table's path
 * (/play/table/<match id>/) so a refresh keeps the seat, and taken off the address bar so it isn't shared by accident.
 */
function ticketKey() {
  return `forge.ticket:${location.pathname.replace(/[^/]*$/, '')}`
}

function saveTicket(ticket: string) {
  try {
    sessionStorage.setItem(ticketKey(), ticket)
  } catch {
    // sessionStorage unavailable
  }
}

function seatTicket() {
  const url = new URL(location.href)
  const fromUrl = url.searchParams.get('ticket')
  const key = ticketKey()
  try {
    if (fromUrl) {
      sessionStorage.setItem(key, fromUrl)
      url.searchParams.delete('ticket')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
      return fromUrl
    }
    return sessionStorage.getItem(key)
  } catch {
    return fromUrl
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
    // Once the match is over, a closed socket is the table closing (a table pod exits after its game), not a blip.
    let over = false
    const { apply, setConnected, clearAsk } = useForge.getState()
    let ticket = seatTicket()

    const connect = () => {
      if (disposed) return
      if (!ticket) {
        setLink('noSeat')
        return
      }
      setLink('connecting')
      // The socket sits beside the page, wherever the table is mounted (/play/table/<id>/ws, or /ws in development).
      const dir = location.pathname.replace(/[^/]*$/, '')
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${dir}ws?ticket=${encodeURIComponent(ticket)}`)
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
        if (m.t === 'hello' && m.ticket) {
          ticket = m.ticket
          saveTicket(m.ticket)
        }
        if (m.t === 'gameOver' || m.t === 'ended') over = true
        try {
          apply(m)
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
        if (ev.code === NO_SEAT) {
          setLink('noSeat')
          return
        }
        if (ev.code === SEAT_REPLACED) {
          setLink('replaced')
          return
        }
        if (over) {
          setLink('over')
          return
        }
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
  useEffect(() => {
    void listenForVoice()
  }, [])
  const inMatch = useForge((s) => s.inMatch)
  const ended = useForge((s) => s.ended)
  const closed = link === 'noSeat' || link === 'replaced'
  return (
    <>
      {closed ? <SeatClosed link={link} note={note} />
        : inMatch ? <div className="fixed inset-0">{match}</div>
        : ended || link === 'over' ? <Ended summary={ended?.summary ?? null} />
        : <Splash link={link} />}
      {link !== 'open' && link !== 'over' && !closed && inMatch && <LinkBadge link={link} retryIn={retryIn} />}
      <Toasts />
      <GameOverModal />
    </>
  )
}

/** Back to wherever the game was started from: the tracker's play page, or this server's root in development. */
function BackLink() {
  const back = useForge((s) => s.returnUrl)
  return back || inLobby
    ? <p style={{ marginTop: 16 }}><a href={back ?? undefined} onClick={(e) => { if (inLobby) { e.preventDefault(); goBack(back) } }}>{inLobby ? 'Back to the lobby' : 'Back to the tracker'}</a></p>
    : null
}

function SeatClosed({ link, note }: { link: 'noSeat' | 'replaced'; note: string }) {
  const title = link === 'replaced' ? 'Opened in another window' : 'No seat here'
  const fallback = link === 'replaced'
    ? 'This window was closed because your seat connected from another window. One window plays at a time.'
    : 'This link has no seat at the game running here. Start or join a game from the tracker.'
  return (
    <div className="tk">
      <div className="tk-center">
        <div>
          <h1>{title}</h1>
          <p>{note || fallback}</p>
          <BackLink />
        </div>
      </div>
    </div>
  )
}

function Ended({ summary }: { summary: string | null }) {
  return (
    <div className="tk">
      <div className="tk-center">
        <div>
          <h1>Game over</h1>
          <p>{summary || 'This game has ended.'}</p>
          <BackLink />
        </div>
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
    <div className="tk">
      <div className="tk-center">
        <div>
          <h1>Play</h1>
          <p><span className={`tk-dot${link === 'retrying' ? ' bad' : ''}`} />{link === 'retrying' ? 'The game server is unreachable. Retrying…' : 'Connecting to the game server…'}</p>
        </div>
      </div>
    </div>
  )
}
