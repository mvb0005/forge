import { useState } from 'react'
import type { Ask } from '../protocol'
import { useForge } from '../store'
import { EnterHint, Frame, useMinimized } from './Frame'
import { answer, Btn, CardTile, Kbd, useDialogKeys } from './ui'

type AskOf<K extends Ask['kind']> = Extract<Ask, { kind: K }>

function SourceCard({ id, width = 200 }: { id: number | null; width?: number }) {
  const card = useForge((s) => (id == null ? undefined : s.cards[id]))
  return card ? <CardTile card={card} width={width} /> : null
}

// confirm and option: a question with a few labelled answers, default one is primary.
export function ConfirmAsk({ ask }: { ask: AskOf<'confirm'> | AskOf<'option'> }) {
  const minimized = useMinimized()
  const cardId = ask.kind === 'confirm' ? ask.cardId : null
  const def = Math.min(Math.max(ask.defaultIndex, 0), ask.options.length - 1)
  useDialogKeys(!minimized, () => answer(ask.id, def))
  const many = ask.options.length > 3
  return (
    <Frame
      title={ask.title || 'Choose'}
      message={ask.message}
      size={cardId != null ? 'md' : 'sm'}
      aside={cardId != null ? <SourceCard id={cardId} width={180} /> : undefined}
      hint={<EnterHint label={ask.options[def]} />}
      footer={!many && ask.options.map((o, i) => (
        <Btn key={i} variant={i === def ? 'primary' : 'secondary'} onClick={() => answer(ask.id, i)} autoFocus={i === def}>{o}</Btn>
      ))}
    >
      {many && (
        <div className="flex flex-col gap-1.5">
          {ask.options.map((o, i) => (
            <Btn key={i} variant={i === def ? 'primary' : 'secondary'} className="justify-start text-left" onClick={() => answer(ask.id, i)}>{o}</Btn>
          ))}
        </div>
      )}
    </Frame>
  )
}

export function InputAsk({ ask }: { ask: AskOf<'input'> }) {
  const minimized = useMinimized()
  const [v, setV] = useState(ask.initial ?? '')
  const valid = ask.numeric ? /^-?\d+$/.test(v.trim()) : true
  const ok = () => valid && answer(ask.id, ask.numeric ? v.trim() : v)
  const cancel = () => answer(ask.id, null)
  useDialogKeys(!minimized, ok, cancel)
  const n = Number(v) || 0
  return (
    <Frame
      title={ask.title || 'Input'}
      message={ask.message}
      size="sm"
      hint={<span className="inline-flex gap-3"><EnterHint /> <span><Kbd>Esc</Kbd> cancel</span></span>}
      footer={<>
        <Btn variant="ghost" onClick={cancel}>Cancel</Btn>
        <Btn variant="primary" disabled={!valid} onClick={ok}>OK</Btn>
      </>}
    >
      <div className="flex items-center gap-2">
        {ask.numeric && <Btn className="w-10 text-lg" onClick={() => setV(String(n - 1))}>−</Btn>}
        <input
          autoFocus
          value={v}
          inputMode={ask.numeric ? 'numeric' : 'text'}
          list={ask.options ? `ask-${ask.id}-opts` : undefined}
          onChange={(e) => setV(e.target.value)}
          className={`min-w-0 flex-1 rounded-lg border bg-table px-3 py-2 text-ink outline-none transition focus:border-accent
            ${ask.numeric ? 'text-center font-mono text-lg' : ''} ${valid ? 'border-line' : 'border-danger'}`}
        />
        {ask.numeric && <Btn className="w-10 text-lg" onClick={() => setV(String(n + 1))}>+</Btn>}
      </div>
      {ask.options && (
        <>
          <datalist id={`ask-${ask.id}-opts`}>{ask.options.map((o) => <option key={o} value={o} />)}</datalist>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ask.options.map((o) => (
              <button key={o} type="button" onClick={() => setV(o)}
                className={`rounded-full border px-3 py-1 text-xs transition ${v === o ? 'border-accent text-accent' : 'border-line text-ink-dim hover:text-ink'}`}>
                {o}
              </button>
            ))}
          </div>
        </>
      )}
    </Frame>
  )
}

export function AbilityAsk({ ask }: { ask: AskOf<'ability'> }) {
  const minimized = useMinimized()
  const card = useForge((s) => s.cards[ask.cardId])
  const cancel = () => answer(ask.id, null)
  useDialogKeys(!minimized, undefined, cancel)
  return (
    <Frame
      title={card ? card.name : 'Choose an ability'}
      message="Choose what to play"
      size="md"
      aside={<SourceCard id={ask.cardId} width={190} />}
      hint={<span><Kbd>Esc</Kbd> cancel</span>}
      footer={<Btn variant="ghost" onClick={cancel}>Cancel</Btn>}
    >
      <div className="flex flex-col gap-2">
        {ask.items.map((it, n) => (
          <button
            key={it.i}
            type="button"
            disabled={!it.enabled}
            autoFocus={n === ask.items.findIndex((x) => x.enabled)}
            onClick={() => answer(ask.id, it.i)}
            className="rounded-lg border border-line bg-panel-2/60 px-4 py-3 text-left text-sm leading-snug transition
              hover:border-playable hover:bg-panel-2 focus-visible:border-playable focus-visible:outline-none
              disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line"
          >
            {it.label}
          </button>
        ))}
      </div>
    </Frame>
  )
}
