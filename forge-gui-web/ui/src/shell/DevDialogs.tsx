import { useEffect, useState } from 'react'
import { setSendTap } from '../net'
import type { ClientMessage, ServerMessage } from '../protocol'
import { useForge } from '../store'
import { asks, extras, lobby, setup } from './fixtures'
import { GameOverModal, Toasts } from './Global'
import { Lobby } from './Lobby'
import { Overlays } from './Overlays'
import { PromptBar } from './PromptBar'

// /?dialogs: every shell surface on fixture data, no server. Outgoing messages are logged, not sent.
export function DevDialogs() {
  const inMatch = useForge((s) => s.inMatch)
  const hasLobby = useForge((s) => !!s.lobby)
  const [sent, setSent] = useState<ClientMessage[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const { apply, setConnected } = useForge.getState()
    setSendTap((m) => {
      console.info('[dev send]', m)
      setSent((s) => [m, ...s].slice(0, 8))
      if (m.t === 'startMatch' || m.t === 'startState') for (const x of setup) apply(x)
    })
    setConnected(true)
    apply(lobby)
    for (const m of setup) apply(m)
    return () => setSendTap(null)
  }, [])

  const run = (msgs: ServerMessage[]) => {
    for (const m of msgs) useForge.getState().apply(m)
  }

  return (
    <>
      {inMatch ? (
        <div className="fixed inset-0 grid place-items-center bg-felt">
          <div className="absolute inset-x-[18%] top-[8%] h-[30%] rounded-2xl border border-line/50 bg-table/40" />
          <div className="absolute inset-x-[18%] bottom-[8%] h-[30%] rounded-2xl border border-line/50 bg-table/40" />
          <PromptBar />
        </div>
      ) : (
        hasLobby && <div className="fixed inset-0"><Lobby /></div>
      )}
      {inMatch && <Overlays />}
      <Toasts />
      <GameOverModal />

      <div className="fixed left-3 top-3 z-[60] w-56 rounded-xl border border-accent/40 bg-panel/95 text-xs shadow-2xl backdrop-blur">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center px-3 py-2 font-semibold text-accent">
          <span className="flex-1 text-left">Dev fixtures</span>{open ? '−' : '+'}
        </button>
        {open && (
          <div className="shell-scroll max-h-[80vh] overflow-y-auto px-2 pb-2">
            <div className="px-1 pb-1 pt-1 text-[10px] uppercase tracking-wider text-ink-dim">Ask</div>
            {asks.map((x) => (
              <button key={x.name} type="button" onClick={() => { if (!inMatch) run(setup); run([x.make()]) }}
                className="block w-full rounded-md px-2 py-1 text-left text-ink-dim hover:bg-panel-2 hover:text-ink">{x.name}</button>
            ))}
            <div className="px-1 pb-1 pt-2 text-[10px] uppercase tracking-wider text-ink-dim">Other</div>
            {extras.map((x) => (
              <button key={x.name} type="button" onClick={() => run(x.msgs())}
                className="block w-full rounded-md px-2 py-1 text-left text-ink-dim hover:bg-panel-2 hover:text-ink">{x.name}</button>
            ))}
            <button type="button" onClick={() => run([lobby])}
              className="block w-full rounded-md px-2 py-1 text-left text-ink-dim hover:bg-panel-2 hover:text-ink">lobby</button>
            <div className="px-1 pb-1 pt-2 text-[10px] uppercase tracking-wider text-ink-dim">Sent</div>
            <ul className="space-y-1 px-1 font-mono text-[10px] text-ink-dim" data-testid="sent">
              {sent.map((m, i) => <li key={i} className="break-all">{JSON.stringify(m)}</li>)}
              {sent.length === 0 && <li>nothing yet</li>}
            </ul>
          </div>
        )}
      </div>
    </>
  )
}
