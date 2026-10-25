import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type DragEvent, type ReactNode } from 'react'
import { CardImage } from '../board/CardImage'
import { send } from '../net'
import type { CardDto, ManaColor } from '../protocol'
import { useForge } from '../store'
import './shell.css'

export function answer(id: number, value: unknown) {
  if (send({ t: 'answer', id, value })) useForge.getState().clearAsk()
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-table hover:brightness-110 font-semibold',
  secondary: 'bg-panel-2 text-ink hover:bg-line border border-line',
  ghost: 'text-ink-dim hover:text-ink hover:bg-panel-2',
  danger: 'bg-danger text-table hover:brightness-110 font-semibold',
}

export function Btn({ variant = 'secondary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...p}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm transition duration-150 select-none
        disabled:opacity-35 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2
        ${variants[variant]} ${className}`}
    />
  )
}

export const manaBg: Record<ManaColor, string> = {
  W: 'bg-mana-w text-table',
  U: 'bg-mana-u text-white',
  B: 'bg-mana-b text-white',
  R: 'bg-mana-r text-white',
  G: 'bg-mana-g text-white',
  C: 'bg-mana-c text-table',
}

export function Pip({ c, size = 16, children }: { c: ManaColor; size?: number; children?: ReactNode }) {
  return (
    <span
      className={`inline-grid place-items-center rounded-full font-bold ring-1 ring-black/30 ${manaBg[c]}`}
      style={{ width: size, height: size, fontSize: size * 0.58 }}
    >
      {children}
    </span>
  )
}

export function ColorPips({ colors, size = 14 }: { colors: string; size?: number }) {
  const cs = [...colors.toUpperCase()].filter((c): c is ManaColor => 'WUBRG'.includes(c))
  if (cs.length === 0) return <Pip c="C" size={size} />
  return <span className="inline-flex gap-1">{cs.map((c) => <Pip key={c} c={c} size={size} />)}</span>
}

// A card face that reports hover to the board's preview.
export function CardTile({ card, width, state, onClick, onDoubleClick, children }: {
  card: CardDto
  width: number
  state?: 'idle' | 'choice' | 'selected' | 'disabled'
  onClick?: () => void
  onDoubleClick?: () => void
  children?: ReactNode
}) {
  const setHovered = useForge((s) => s.setHovered)
  const ring =
    state === 'selected' ? 'ring-3 ring-accent -translate-y-1'
    : state === 'choice' ? 'ring-2 ring-target/50 hover:ring-target hover:-translate-y-0.5'
    : state === 'disabled' ? 'opacity-40 grayscale'
    : ''
  return (
    <div
      className={`relative rounded-[6%] transition duration-150 ${onClick ? 'cursor-pointer' : ''} ${ring}`}
      style={{ width }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(card.id)}
      onMouseLeave={() => setHovered(null)}
    >
      <CardImage card={card} width={width} />
      {children}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-table px-1.5 py-px font-mono text-[10px] text-ink-dim">{children}</kbd>
}

export function Stepper({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-line bg-table">
      <button type="button" className="h-8 w-8 rounded-l-lg text-lg text-ink-dim hover:bg-panel-2 hover:text-ink disabled:opacity-30"
        disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span className="w-9 text-center font-mono text-sm tabular-nums">{value}</span>
      <button type="button" className="h-8 w-8 rounded-r-lg text-lg text-ink-dim hover:bg-panel-2 hover:text-ink disabled:opacity-30"
        disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

export function IconBtn({ title, onClick, children, disabled }: { title: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md text-ink-dim transition hover:bg-line hover:text-ink disabled:pointer-events-none disabled:opacity-25">
      {children}
    </button>
  )
}

export function move<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice()
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

// Native HTML5 drag-and-drop reordering for a list. Returns per-row props and the row being dragged over.
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const from = useRef<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const row = (i: number, enabled = true) =>
    enabled
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            from.current = i
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(i))
          },
          onDragOver: (e: DragEvent) => {
            if (from.current === null) return
            e.preventDefault()
            setOver(i)
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            if (from.current !== null && from.current !== i) onMove(from.current, i)
            from.current = null
            setOver(null)
          },
          onDragEnd: () => {
            from.current = null
            setOver(null)
          },
        }
      : {}
  return { row, over }
}

// Enter / Escape for the open dialog. Ignored while minimised.
export function useDialogKeys(active: boolean, onEnter?: () => void, onEsc?: () => void) {
  const ref = useRef({ onEnter, onEsc })
  useLayoutEffect(() => {
    ref.current = { onEnter, onEsc }
  })
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && ref.current.onEnter) {
        if (e.target instanceof HTMLButtonElement && e.target.closest('[role=dialog]')) return // that button handles it
        e.preventDefault()
        ref.current.onEnter()
      } else if (e.key === 'Escape' && ref.current.onEsc) {
        e.preventDefault()
        ref.current.onEsc()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [active])
}
