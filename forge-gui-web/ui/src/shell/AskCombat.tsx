import { useState } from 'react'
import type { Ask, CardDto, EntityRef } from '../protocol'
import { entityKey, useForge } from '../store'
import { EnterHint, Frame, useMinimized } from './Frame'
import { answer, Btn, CardTile, IconBtn, Kbd, move, Stepper, useDialogKeys } from './ui'

type AskOf<K extends Ask['kind']> = Extract<Ask, { kind: K }>

const lethalFor = (b: CardDto | undefined, deathtouch: boolean) => {
  if (!b || b.toughness == null) return 0
  const left = Math.max(0, b.toughness - b.damage)
  return deathtouch ? Math.min(1, left) : left
}

function Remaining({ left }: { left: number }) {
  return (
    <span className={`font-mono tabular-nums ${left === 0 ? 'text-playable' : left > 0 ? 'text-target' : 'text-danger'}`}>
      {left === 0 ? 'All assigned' : left > 0 ? `${left} left to assign` : `${-left} too many`}
    </span>
  )
}

export function DamageAsk({ ask }: { ask: AskOf<'damage'> }) {
  const minimized = useMinimized()
  const cards = useForge((s) => s.cards)
  const players = useForge((s) => s.players)
  const attacker = cards[ask.attackerId]
  const deathtouch = !!attacker?.keywords.includes('deathtouch')
  const [order, setOrder] = useState(ask.blockerIds)
  const targets: EntityRef[] = [...order.map((id): EntityRef => ({ kind: 'card', id })), ...(ask.defender ? [ask.defender] : [])]

  const preset = (ids: number[]) => {
    const out: Record<string, number> = {}
    let left = ask.damage
    for (const id of ids) {
      const n = Math.min(left, lethalFor(cards[id], deathtouch))
      out[`card:${id}`] = n
      left -= n
    }
    const sink = ask.defender ? entityKey(ask.defender) : ids.length ? `card:${ids[ids.length - 1]}` : null
    if (sink) out[sink] = (out[sink] ?? 0) + left
    return out
  }
  const [amt, setAmt] = useState<Record<string, number>>(() => preset(ask.blockerIds))
  const total = Object.values(amt).reduce((a, b) => a + b, 0)
  const left = ask.damage - total
  const ok = left === 0
  const submit = () => {
    if (!ok) return
    const value: Record<string, number> = {}
    for (const t of targets) value[entityKey(t)] = amt[entityKey(t)] ?? 0
    answer(ask.id, value)
  }
  const skip = () => answer(ask.id, null)
  useDialogKeys(!minimized, submit, ask.maySkip ? skip : undefined)
  const set = (k: string, v: number) => setAmt((a) => ({ ...a, [k]: v }))
  const nameOf = (e: EntityRef) => (e.kind === 'player' ? players[e.id]?.name ?? 'Defending player' : cards[e.id]?.name ?? `Card ${e.id}`)

  return (
    <Frame
      title="Assign combat damage"
      message={`${attacker?.name ?? 'Attacker'} deals ${ask.damage} damage${deathtouch ? ' (deathtouch: 1 is lethal)' : ''}`}
      size="lg"
      aside={attacker && (
        <div className="flex flex-col items-center gap-2">
          <CardTile card={attacker} width={170} />
          <span className="rounded-full bg-danger/15 px-3 py-1 font-mono text-sm text-danger">{ask.damage} damage</span>
        </div>
      )}
      hint={<span className="inline-flex gap-3"><Remaining left={left} /><EnterHint /></span>}
      footer={<>
        <Btn variant="ghost" onClick={() => setAmt({})}>Reset</Btn>
        <Btn onClick={() => setAmt(preset(order))}>Lethal in order</Btn>
        {ask.maySkip && <Btn variant="ghost" onClick={skip}>Skip</Btn>}
        <Btn variant="primary" disabled={!ok} onClick={submit}>Assign</Btn>
      </>}
    >
      <ul className="flex flex-col gap-2">
        {order.map((id, n) => {
          const b = cards[id]
          const k = `card:${id}`
          const v = amt[k] ?? 0
          const lethal = lethalFor(b, deathtouch)
          const dead = b != null && v >= lethal && v > 0
          return (
            <li key={id} className={`flex items-center gap-4 rounded-xl border p-2.5 pr-4 transition ${dead ? 'border-danger/60 bg-danger/5' : 'border-line bg-panel-2/40'}`}>
              {b && <CardTile card={b} width={72} />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{b?.name ?? `Card ${id}`}</div>
                <div className="mt-0.5 text-xs text-ink-dim">
                  {b?.power ?? '?'}/{b?.toughness ?? '?'}
                  {b && b.damage > 0 && <span className="text-danger"> · {b.damage} damage marked</span>}
                  <span> · lethal {lethal}</span>
                </div>
                {dead && <span className="mt-1 inline-block rounded bg-danger/20 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-danger">Lethal</span>}
              </div>
              {ask.overrideOrder && order.length > 1 && (
                <span className="flex flex-col">
                  <IconBtn title="Earlier" disabled={n === 0} onClick={() => setOrder((o) => move(o, n, n - 1))}>↑</IconBtn>
                  <IconBtn title="Later" disabled={n === order.length - 1} onClick={() => setOrder((o) => move(o, n, n + 1))}>↓</IconBtn>
                </span>
              )}
              <button type="button" className="text-xs text-ink-dim hover:text-ink" onClick={() => set(k, Math.min(ask.damage, v + Math.max(0, left)))}>+rest</button>
              <Stepper value={v} min={0} max={v + Math.max(0, left)} onChange={(x) => set(k, x)} />
            </li>
          )
        })}
        {ask.defender && (() => {
          const k = entityKey(ask.defender)
          const v = amt[k] ?? 0
          return (
            <li className="flex items-center gap-4 rounded-xl border border-dashed border-line p-3 pr-4">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-panel-2 text-lg">{ask.defender.kind === 'player' ? '♟' : '◆'}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{nameOf(ask.defender)}</div>
                <div className="text-xs text-ink-dim">Excess damage (trample)</div>
              </div>
              <button type="button" className="text-xs text-ink-dim hover:text-ink" onClick={() => set(k, v + Math.max(0, left))}>+rest</button>
              <Stepper value={v} min={0} max={v + Math.max(0, left)} onChange={(x) => set(k, x)} />
            </li>
          )
        })()}
      </ul>
    </Frame>
  )
}

export function AmountAsk({ ask }: { ask: AskOf<'amount'> }) {
  const minimized = useMinimized()
  const cards = useForge((s) => s.cards)
  const players = useForge((s) => s.players)
  const source = ask.sourceCardId == null ? undefined : cards[ask.sourceCardId]
  const floor = ask.atLeastOne ? 1 : 0
  const [amt, setAmt] = useState<Record<number, number>>(() => Object.fromEntries(ask.items.map((it) => [it.i, floor])))
  const total = Object.values(amt).reduce((a, b) => a + b, 0)
  const left = ask.amount - total
  const ok = left === 0
  const submit = () => ok && answer(ask.id, Object.fromEntries(ask.items.map((it) => [String(it.i), amt[it.i] ?? 0])))
  useDialogKeys(!minimized, submit)
  const even = () => {
    const n = ask.items.length
    if (!n) return
    const base = Math.floor(ask.amount / n)
    setAmt(Object.fromEntries(ask.items.map((it, k) => [it.i, base + (k < ask.amount % n ? 1 : 0)])))
  }

  return (
    <Frame
      title={ask.label || 'Distribute'}
      message={`Distribute ${ask.amount}${ask.atLeastOne ? ', at least 1 each' : ''}`}
      size="md"
      aside={source && <CardTile card={source} width={160} />}
      hint={<span className="inline-flex gap-3"><Remaining left={left} /><EnterHint /></span>}
      footer={<>
        {ask.items.length > 1 && <Btn variant="ghost" onClick={even}>Split evenly</Btn>}
        <Btn variant="primary" disabled={!ok} onClick={submit}>Confirm</Btn>
      </>}
    >
      <ul className="flex flex-col gap-2">
        {ask.items.map((it) => {
          const card = it.ref?.kind === 'card' ? cards[it.ref.id] : undefined
          const label = it.ref?.kind === 'player' ? players[it.ref.id]?.name ?? it.label : it.label
          const v = amt[it.i] ?? 0
          return (
            <li key={it.i} className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/40 p-2.5 pr-4">
              {card && <CardTile card={card} width={56} />}
              <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
              <Stepper value={v} min={floor} max={v + Math.max(0, left)} onChange={(x) => setAmt((a) => ({ ...a, [it.i]: x }))} />
            </li>
          )
        })}
      </ul>
      {ask.items.length === 0 && <p className="text-sm text-ink-dim"><Kbd>Enter</Kbd> nothing to distribute</p>}
    </Frame>
  )
}
