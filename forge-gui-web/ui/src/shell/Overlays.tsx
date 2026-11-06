import { useEffect, useRef, useState } from 'react'
import { send } from '../net'
import type { Ask } from '../protocol'
import { useForge } from '../store'
import { ArrangeAsk } from './AskArrange'
import { ChooseAsk, OrderAsk } from './AskChoose'
import { AmountAsk, DamageAsk } from './AskCombat'
import { AbilityAsk, ConfirmAsk, InputAsk } from './AskSimple'
import { MinimizeCtx } from './Frame'
import { Btn, Kbd } from './ui'

// Everything drawn over the table during a match: ask dialogs, menu. (Reveals show at the revealer's seat.) (The log is the table's side column.)
export function Overlays() {
  return (
    <>
      <TopMenu />
      <AskHost />
    </>
  )
}

export function AskHost() {
  const ask = useForge((s) => s.ask)
  if (!ask) return null
  return <AskWithMinimize key={ask.id} ask={ask} />
}

function AskWithMinimize({ ask }: { ask: Ask }) {
  const [minimized, setMinimized] = useState(false)
  return (
    <MinimizeCtx.Provider value={{ minimized, setMinimized }}>
      <AskBody ask={ask} />
    </MinimizeCtx.Provider>
  )
}

function AskBody({ ask }: { ask: Ask }) {
  switch (ask.kind) {
    case 'confirm':
    case 'option':
      return <ConfirmAsk ask={ask} />
    case 'input':
      return <InputAsk ask={ask} />
    case 'choose':
      return <ChooseAsk ask={ask} />
    case 'order':
      return <OrderAsk ask={ask} />
    case 'ability':
      return <AbilityAsk ask={ask} />
    case 'damage':
      return <DamageAsk ask={ask} />
    case 'amount':
      return <AmountAsk ask={ask} />
    case 'arrange':
      return <ArrangeAsk ask={ask} />
    default: {
      // Unknown kind from a newer server: never leave the game thread waiting without a way out.
      const a = ask as { id: number; kind: string }
      return (
        <div className="fixed inset-x-0 bottom-6 z-40 mx-auto w-fit rounded-xl border border-danger bg-panel px-5 py-3 text-sm">
          Unsupported question “{a.kind}”.{' '}
          <Btn variant="danger" onClick={() => send({ t: 'answer', id: a.id, value: null }) && useForge.getState().clearAsk()}>Answer with nothing</Btn>
        </div>
      )
    }
  }
}

function TopMenu() {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false)
        setConfirming(false)
      }
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div ref={ref} className="fixed right-3 top-3 z-30 flex items-start gap-1.5">
      <div className="relative">
        <button type="button" aria-label="Menu" onClick={() => { setOpen((o) => !o); setConfirming(false) }}
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${open ? 'border-accent text-ink' : 'border-line bg-panel/90 text-ink-dim hover:text-ink'}`}>
          •••
        </button>
        {open && (
          <div className="shell-in absolute right-0 mt-1.5 w-56 rounded-xl lk-plate p-1.5">
            {!confirming ? (
              <>
                <MenuItem onClick={() => { send({ t: 'undo' }); setOpen(false) }} kbd="Z">Undo</MenuItem>
                <MenuItem danger onClick={() => setConfirming(true)}>Concede…</MenuItem>
              </>
            ) : (
              <div className="p-2">
                <p className="mb-3 text-sm">Concede this game?</p>
                <div className="flex gap-2">
                  <Btn variant="ghost" className="flex-1" onClick={() => setConfirming(false)}>Keep playing</Btn>
                  <Btn variant="danger" className="flex-1" autoFocus onClick={() => { send({ t: 'concede' }); setOpen(false); setConfirming(false) }}>Concede</Btn>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ children, onClick, kbd, danger }: { children: string; onClick: () => void; kbd?: string; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition hover:bg-panel-2 ${danger ? 'text-danger' : ''}`}>
      <span className="flex-1">{children}</span>
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  )
}
