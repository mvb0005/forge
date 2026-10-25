import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Ask } from '../protocol'
import { useForge } from '../store'
import { EnterHint, Frame, useMinimized } from './Frame'
import { answer, Btn, CardTile, IconBtn, useDialogKeys } from './ui'

type AskOf<K extends Ask['kind']> = Extract<Ask, { kind: K }>
type Zone = 'top' | 'mid' | 'bottom'

// manipulateCardList: cardIds is the whole pile (first = top). Movable cards go either anywhere
// (toAnywhere) or into a run at the top / bottom. The answer is every id in final order.
export function ArrangeAsk({ ask }: { ask: AskOf<'arrange'> }) {
  const minimized = useMinimized()
  const cards = useForge((s) => s.cards)
  const movable = new Set(ask.manipulableIds)
  const anywhere = ask.toAnywhere || (!ask.toTop && !ask.toBottom)

  const [zones, setZones] = useState<Record<Zone, number[]>>(() => {
    if (anywhere) return { top: [], mid: ask.cardIds, bottom: [] }
    const ids = ask.cardIds
    let a = 0
    while (a < ids.length && movable.has(ids[a])) a++
    let b = ids.length
    while (b > a && movable.has(ids[b - 1])) b--
    const top = ask.toTop ? ids.slice(0, a) : []
    const bottom = ask.toBottom ? ids.slice(b) : []
    const mid: number[] = []
    for (const id of ids.slice(ask.toTop ? a : 0, ask.toBottom ? b : ids.length)) {
      if (!movable.has(id)) mid.push(id)
      else if (ask.toTop) top.push(id)
      else bottom.push(id)
    }
    return { top, mid, bottom }
  })

  const drag = useRef<number | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const place = (id: number, zone: Zone, before: number | null) =>
    setZones((z) => {
      const next = { top: z.top.filter((x) => x !== id), mid: z.mid.filter((x) => x !== id), bottom: z.bottom.filter((x) => x !== id) }
      const list = next[zone]
      const at = before == null ? list.length : list.indexOf(before)
      list.splice(at < 0 ? list.length : at, 0, id)
      return next
    })
  const shift = (zone: Zone, id: number, d: number) =>
    setZones((z) => {
      const list = z[zone].slice()
      const i = list.indexOf(id)
      const j = i + d
      if (j < 0 || j >= list.length) return z
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...z, [zone]: list }
    })

  const final = [...zones.top, ...zones.mid, ...zones.bottom]
  const submit = () => answer(ask.id, final)
  useDialogKeys(!minimized, submit)

  const dropProps = (zone: Zone, before: number | null) => ({
    onDragOver: (e: DragEvent) => {
      if (drag.current == null) return
      e.preventDefault()
      e.stopPropagation()
      setOver(`${zone}:${before}`)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (drag.current != null && drag.current !== before) place(drag.current, zone, before)
      drag.current = null
      setOver(null)
    },
  })

  const tile = (zone: Zone, id: number, n: number, len: number) => {
    const card = cards[id]
    const can = movable.has(id)
    return (
      <div
        key={id}
        draggable={can}
        onDragStart={(e) => {
          drag.current = id
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(id))
        }}
        onDragEnd={() => { drag.current = null; setOver(null) }}
        {...(zone === 'mid' && !anywhere ? {} : dropProps(zone, id))}
        className={`relative flex shrink-0 flex-col items-center gap-1 rounded-lg p-1 transition
          ${over === `${zone}:${id}` ? 'bg-accent/15 ring-2 ring-accent' : ''} ${can ? 'cursor-grab' : ''}`}
      >
        {card ? <CardTile card={card} width={112} state={can ? 'idle' : 'disabled'} /> : <div className="h-[156px] w-[112px] rounded-lg bg-panel-2" />}
        {can ? (
          <div className="flex gap-0.5">
            <IconBtn title="Earlier" disabled={n === 0} onClick={() => shift(zone, id, -1)}>←</IconBtn>
            {!anywhere && ask.toTop && zone !== 'top' && <IconBtn title="To top" onClick={() => place(id, 'top', null)}>⤒</IconBtn>}
            {!anywhere && ask.toBottom && zone !== 'bottom' && <IconBtn title="To bottom" onClick={() => place(id, 'bottom', zones.bottom[0] ?? null)}>⤓</IconBtn>}
            <IconBtn title="Later" disabled={n === len - 1} onClick={() => shift(zone, id, 1)}>→</IconBtn>
          </div>
        ) : <span className="h-7 text-[10px] uppercase tracking-wide text-ink-dim">fixed</span>}
      </div>
    )
  }

  const zone = (z: Zone, label: string, sub: ReactNode) => (
    <section
      {...(z === 'mid' && !anywhere ? {} : dropProps(z, null))}
      className={`rounded-xl border p-3 transition ${over === `${z}:null` ? 'border-accent bg-accent/5' : z === 'mid' && !anywhere ? 'border-line/60 bg-table/40' : 'border-line bg-panel-2/30'}`}
    >
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink">{label}</span>
        <span className="text-xs text-ink-dim">{sub}</span>
      </div>
      <div className="shell-scroll flex min-h-[120px] gap-1 overflow-x-auto pb-1">
        {zones[z].map((id, n) => tile(z, id, n, zones[z].length))}
        {zones[z].length === 0 && <div className="grid flex-1 place-items-center text-sm text-ink-dim">Drop cards here</div>}
      </div>
    </section>
  )

  return (
    <Frame
      title={ask.title || 'Arrange cards'}
      size="xl"
      hint={<span className="inline-flex gap-3"><span>Drag cards or use the arrows · leftmost is first</span><EnterHint /></span>}
      footer={<Btn variant="primary" onClick={submit}>Done</Btn>}
    >
      <div className="flex flex-col gap-3">
        {anywhere ? zone('mid', 'Order', 'top → bottom') : <>
          {ask.toTop && zone('top', 'Top', 'first card ends on top')}
          {zones.mid.length > 0 && zone('mid', 'Unchanged', `${zones.mid.length} card${zones.mid.length === 1 ? '' : 's'} stay in place`)}
          {ask.toBottom && zone('bottom', 'Bottom', 'last card ends on the bottom')}
        </>}
      </div>
    </Frame>
  )
}
