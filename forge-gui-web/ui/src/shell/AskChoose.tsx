import { useState, type PointerEvent } from 'react'
import { ManaCost } from '../look/ManaSymbol'
import { peekTimer } from '../popover/store'
import { usePeek } from '../popover/usePeek'
import type { Ask, CardDto, ChoiceItem } from '../protocol'
import { useForge } from '../store'
import { EnterHint, Frame, useMinimized } from './Frame'
import { answer, Btn, CardTile, IconBtn, Kbd, move, useDragReorder, useDialogKeys } from './ui'

type AskOf<K extends Ask['kind']> = Extract<Ask, { kind: K }>

function useItemCards() {
  const cards = useForge((s) => s.cards)
  const players = useForge((s) => s.players)
  const cardOf = (it: ChoiceItem): CardDto | undefined => (it.ref?.kind === 'card' ? cards[it.ref.id] : undefined)
  const labelOf = (it: ChoiceItem) => (it.ref?.kind === 'player' ? players[it.ref.id]?.name ?? it.label : it.label)
  return { cardOf, labelOf }
}

// Face-up library cards. Hidden cards with no name stay on the ordinary grid.
function isLibrarySearch(ask: AskOf<'choose'>, cards: Record<number, CardDto>): boolean {
  if (ask.items.length === 0) return false
  for (const it of ask.items) {
    const c = it.ref?.kind === 'card' ? cards[it.ref.id] : undefined
    if (!c || c.zone !== 'library' || !c.name.trim()) return false
  }
  return true
}

function matches(card: CardDto, q: string) {
  const n = q.trim().toLowerCase()
  if (!n) return true
  return card.name.toLowerCase().includes(n) || card.typeLine.toLowerCase().includes(n)
}

function LibraryRow({ card, on, mark, dim, hot, onPick, onHot }: {
  card: CardDto
  on: boolean
  mark: number | null
  dim: boolean
  hot: boolean
  onPick: () => void
  onHot: () => void
}) {
  const peek = usePeek({ kind: 'card', id: card.id })
  return (
    <button
      type="button"
      id={`lib-row-${card.id}`}
      {...peek}
      onPointerEnter={(e) => {
        peek.onPointerEnter(e)
        onHot()
      }}
      onFocus={(e) => {
        peek.onFocus(e)
        onHot()
      }}
      onClick={onPick}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-1.5 text-left transition
        ${on ? 'border-accent bg-accent/10' : hot ? 'border-target bg-panel-2/80' : 'border-line bg-panel-2/40 hover:border-target'}
        focus-visible:border-target focus-visible:outline-none ${dim ? 'opacity-40' : ''}`}
    >
      {mark != null && (
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${on ? 'bg-accent text-table' : 'border border-line text-transparent'}`}>
          {on ? mark : ''}
        </span>
      )}
      <span className="flex min-w-16 shrink-0 justify-end"><ManaCost cost={card.manaCost} size={15} /></span>
      <span className="min-w-0 flex-1 truncate font-title text-[15px] font-bold">{card.name}</span>
      <span className="min-w-0 max-w-[46%] shrink truncate text-xs text-ink-dim">{card.typeLine}</span>
    </button>
  )
}

function LibrarySearch({ ask }: { ask: AskOf<'choose'> }) {
  const minimized = useMinimized()
  const cards = useForge((s) => s.cards)
  const max = Math.min(ask.max, ask.items.length)
  const min = Math.min(ask.min, max)
  const single = max <= 1
  const [sel, setSel] = useState<number[]>(() => ask.selected.filter((i) => ask.items.some((it) => it.i === i)).slice(0, max))
  const [q, setQ] = useState('')
  const [hi, setHi] = useState<number | null>(null)
  const ok = sel.length >= min && sel.length <= max
  const submit = () => ok && answer(ask.id, sel)
  const skip = () => answer(ask.id, [])
  const toggle = (i: number) => {
    if (single) return answer(ask.id, [i])
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : s.length < max ? [...s, i] : s))
  }
  useDialogKeys(!minimized, single ? undefined : submit, min === 0 ? skip : undefined)

  const cardAt = (it: ChoiceItem) => (it.ref?.kind === 'card' ? cards[it.ref.id] : undefined)
  const filtered = ask.items.filter((it) => {
    const c = cardAt(it)
    return !!c && matches(c, q)
  })
  const shownHi = filtered.some((it) => it.i === hi) ? hi : (filtered[0]?.i ?? null)
  const hotItem = filtered.find((it) => it.i === shownHi)
  const preview = hotItem ? cardAt(hotItem) : undefined
  const full = !single && sel.length >= max
  const rule = min === max ? `choose ${max}` : max >= ask.items.length && min === 0 ? 'any number' : `${min}–${max}`

  const moveHi = (dir: 1 | -1) => {
    if (!filtered.length) return
    const at = filtered.findIndex((it) => it.i === shownHi)
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, (at < 0 ? 0 : at) + dir))]
    setHi(next.i)
    const id = cardAt(next)?.id
    if (id != null) document.getElementById(`lib-row-${id}`)?.scrollIntoView?.({ block: 'nearest' })
  }

  return (
    <Frame
      title={ask.title || 'Search your library'}
      message={ask.message}
      size="xl"
      aside={preview ? <CardTile card={preview} width={200} /> : undefined}
      hint={single
        ? (min === 0 ? <span className="inline-flex gap-1.5"><Kbd>Esc</Kbd> choose nothing</span> : 'Click to choose')
        : <span className="inline-flex gap-3">
            <span className={ok ? 'text-ink' : 'text-target'}>{sel.length} chosen <span className="text-ink-dim">· {rule}</span></span>
            <EnterHint />
          </span>}
      footer={<>
        {!single && max >= ask.items.length && ask.items.length > 2 && (
          <Btn variant="ghost" onClick={() => setSel(sel.length === ask.items.length ? [] : ask.items.map((it) => it.i))}>
            {sel.length === ask.items.length ? 'Clear' : 'All'}
          </Btn>
        )}
        {min === 0 && <Btn variant={single ? 'secondary' : 'ghost'} onClick={skip}>{single ? 'Choose nothing' : 'Skip'}</Btn>}
        {!single && <Btn variant="primary" disabled={!ok} onClick={submit}>Confirm</Btn>}
      </>}
    >
      <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-3 bg-panel px-1 pb-2">
        <input
          autoFocus
          value={q}
          spellCheck={false}
          placeholder="Name or type"
          aria-label="Filter by name or type"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              moveHi(e.key === 'ArrowDown' ? 1 : -1)
            } else if (e.key === 'Enter' && single) {
              e.preventDefault()
              const pick = filtered.find((it) => it.i === shownHi) ?? filtered[0]
              if (pick) answer(ask.id, [pick.i])
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-line bg-table px-3 py-2 text-sm text-ink outline-none transition focus:border-accent"
        />
        <span className="shrink-0 font-title text-xs font-bold text-ink-dim">{filtered.length}/{ask.items.length}</span>
      </div>
      <div className="flex flex-col gap-1">
        {filtered.map((it) => {
          const card = cardAt(it)!
          const on = sel.includes(it.i)
          return (
            <LibraryRow
              key={it.i}
              card={card}
              on={on}
              mark={single ? null : sel.indexOf(it.i) + 1}
              dim={full && !on}
              hot={it.i === shownHi}
              onHot={() => setHi(it.i)}
              onPick={() => toggle(it.i)}
            />
          )
        })}
        {filtered.length === 0 && <p className="py-8 text-center text-sm text-ink-dim">No matching cards</p>}
      </div>
    </Frame>
  )
}

export function ChooseAsk({ ask }: { ask: AskOf<'choose'> }) {
  const cards = useForge((s) => s.cards)
  return isLibrarySearch(ask, cards) ? <LibrarySearch ask={ask} /> : <ChooseList ask={ask} />
}

function ChooseList({ ask }: { ask: AskOf<'choose'> }) {
  const minimized = useMinimized()
  const { cardOf, labelOf } = useItemCards()
  const max = Math.min(ask.max, ask.items.length)
  const min = Math.min(ask.min, max)
  const single = max <= 1
  const [sel, setSel] = useState<number[]>(() => ask.selected.filter((i) => ask.items.some((it) => it.i === i)).slice(0, max))
  const ok = sel.length >= min && sel.length <= max
  const submit = () => ok && answer(ask.id, sel)
  const skip = () => answer(ask.id, [])
  const toggle = (i: number) => {
    if (single) return answer(ask.id, [i])
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : s.length < max ? [...s, i] : s))
  }
  useDialogKeys(!minimized, single ? undefined : submit, min === 0 ? skip : undefined)

  const withCard = ask.items.filter((it) => cardOf(it))
  const rest = ask.items.filter((it) => !cardOf(it))
  const tileW = withCard.length > 8 ? 132 : 158
  const full = !single && sel.length >= max
  const rule = min === max ? `choose ${max}` : max >= ask.items.length && min === 0 ? 'any number' : `${min}–${max}`

  return (
    <Frame
      title={ask.title || 'Choose'}
      message={ask.message}
      size={withCard.length > 3 ? 'xl' : withCard.length ? 'lg' : 'sm'}
      hint={single
        ? (min === 0 ? <span className="inline-flex gap-1.5"><Kbd>Esc</Kbd> choose nothing</span> : 'Click to choose')
        : <span className="inline-flex gap-3">
            <span className={ok ? 'text-ink' : 'text-target'}>{sel.length} chosen <span className="text-ink-dim">· {rule}</span></span>
            <EnterHint />
          </span>}
      footer={<>
        {!single && max >= ask.items.length && ask.items.length > 2 && (
          <Btn variant="ghost" onClick={() => setSel(sel.length === ask.items.length ? [] : ask.items.map((it) => it.i))}>
            {sel.length === ask.items.length ? 'Clear' : 'All'}
          </Btn>
        )}
        {min === 0 && <Btn variant={single ? 'secondary' : 'ghost'} onClick={skip}>{single ? 'Choose nothing' : 'Skip'}</Btn>}
        {!single && <Btn variant="primary" disabled={!ok} onClick={submit}>Confirm</Btn>}
      </>}
    >
      {withCard.length > 0 && (
        <div className="grid justify-center gap-3 p-1.5" style={{ gridTemplateColumns: `repeat(auto-fill, ${tileW}px)` }}>
          {withCard.map((it) => {
            const on = sel.includes(it.i)
            return (
              <CardTile key={it.i} card={cardOf(it)!} width={tileW} state={on ? 'selected' : full ? 'disabled' : 'choice'} onClick={() => toggle(it.i)}>
                {on && !single && (
                  <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold text-table shadow">
                    {sel.indexOf(it.i) + 1}
                  </span>
                )}
              </CardTile>
            )
          })}
        </div>
      )}
      {rest.length > 0 && (
        <div className={`flex flex-col gap-1.5 ${withCard.length ? 'mt-4 border-t border-line pt-4' : ''}`}>
          {rest.map((it, n) => {
            const on = sel.includes(it.i)
            return (
              <button
                key={it.i}
                type="button"
                autoFocus={single && n === 0}
                onClick={() => toggle(it.i)}
                className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition
                  ${on ? 'border-accent bg-accent/10' : 'border-line bg-panel-2/50 hover:border-target focus-visible:border-target focus-visible:outline-none'}
                  ${full && !on ? 'opacity-40' : ''}`}
              >
                {!single && (
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${on ? 'border-accent bg-accent text-table' : 'border-line'}`}>
                    {on ? '✓' : ''}
                  </span>
                )}
                {it.ref?.kind === 'player' && <span className="text-xs uppercase tracking-wide text-ink-dim">Player</span>}
                <span className="flex-1">{labelOf(it)}</span>
              </button>
            )
          })}
        </div>
      )}
    </Frame>
  )
}

export function OrderAsk({ ask }: { ask: AskOf<'order'> }) {
  const minimized = useMinimized()
  const { cardOf, labelOf } = useItemCards()
  const source = useForge((s) => (ask.cardId == null ? undefined : s.cards[ask.cardId]))
  const plain = ask.min >= ask.items.length && ask.max >= ask.items.length
  const [chosen, setChosen] = useState<number[]>(() => (plain ? ask.items.map((it) => it.i) : []))
  const ok = chosen.length >= ask.min && chosen.length <= ask.max
  const submit = () => ok && answer(ask.id, chosen)
  useDialogKeys(!minimized, submit)
  const { row, over } = useDragReorder((from, to) => setChosen((c) => move(c, from, to)))
  const byI = new Map(ask.items.map((it) => [it.i, it]))
  const available = ask.items.filter((it) => !chosen.includes(it.i))
  // Rows name a card without showing it; hovering one peeks the card.
  const hover = (it: ChoiceItem) => {
    const c = cardOf(it)
    if (!c) return {}
    const key = `card:${c.id}`
    return {
      onPointerEnter: (e: PointerEvent<Element>) => {
        const r = e.currentTarget.getBoundingClientRect()
        peekTimer.enter(key, { key, entity: { kind: 'card', id: c.id }, anchor: { x: r.left, y: r.top, w: r.width, h: r.height } })
      },
      onPointerLeave: () => peekTimer.leave(key),
    }
  }

  const list = (
    <ol className="flex flex-col gap-1.5">
      <li className="px-1 text-[11px] uppercase tracking-wider text-ink-dim">First</li>
      {chosen.map((i, n) => {
        const it = byI.get(i)!
        return (
          <li
            key={i}
            {...row(n)}
            {...hover(it)}
            className={`flex cursor-grab items-center gap-3 rounded-lg border bg-panel-2/60 px-3 py-2 text-sm transition active:cursor-grabbing
              ${over === n ? 'border-accent' : 'border-line'}`}
          >
            <span className="w-5 text-right font-mono text-xs text-ink-dim">{n + 1}</span>
            <span className="text-ink-dim/60">⋮⋮</span>
            <span className="min-w-0 flex-1 truncate">{labelOf(it)}</span>
            <span className="flex gap-0.5">
              <IconBtn title="Move up" disabled={n === 0} onClick={() => setChosen((c) => move(c, n, n - 1))}>↑</IconBtn>
              <IconBtn title="Move down" disabled={n === chosen.length - 1} onClick={() => setChosen((c) => move(c, n, n + 1))}>↓</IconBtn>
              {!plain && <IconBtn title="Remove" onClick={() => setChosen((c) => c.filter((x) => x !== i))}>×</IconBtn>}
            </span>
          </li>
        )
      })}
      {chosen.length === 0 && (
        <li className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-dim">Pick from the left to add</li>
      )}
    </ol>
  )

  return (
    <Frame
      title={ask.title || 'Order'}
      message={ask.message}
      size={plain ? 'md' : 'lg'}
      aside={source ? <CardTile card={source} width={170} /> : undefined}
      hint={<span className="inline-flex gap-3">
        <span>Drag or use the arrows</span>
        {!plain && <span className={ok ? '' : 'text-target'}>{chosen.length} chosen · {ask.min === ask.max ? `need ${ask.min}` : `${ask.min}–${ask.max}`}</span>}
        <EnterHint />
      </span>}
      footer={<Btn variant="primary" disabled={!ok} onClick={submit}>{plain ? 'Confirm order' : 'Confirm'}</Btn>}
    >
      {plain ? list : (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="px-1 text-[11px] uppercase tracking-wider text-ink-dim">Available</div>
            {available.map((it) => (
              <button key={it.i} type="button" disabled={chosen.length >= ask.max} {...hover(it)}
                onClick={() => setChosen((c) => [...c, it.i])}
                className="rounded-lg border border-line bg-panel-2/40 px-3 py-2 text-left text-sm transition hover:border-target disabled:opacity-40">
                {labelOf(it)}
              </button>
            ))}
            {available.length === 0 && <div className="px-1 text-sm text-ink-dim">Everything is chosen</div>}
          </div>
          {list}
        </div>
      )}
    </Frame>
  )
}
