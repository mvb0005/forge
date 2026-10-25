import { memo } from 'react'
import './theme'

// Counter names arrive lower-cased from CounterType.getName() ("+1/+1", "-1/-1", "loyal", "charge"); fixtures use P1P1.
export function counterKind(name: string): 'plus' | 'minus' | 'loyalty' | 'other' {
  const n = name.toLowerCase()
  if (n === '+1/+1' || n === 'p1p1') return 'plus'
  if (n === '-1/-1' || n === 'm1m1') return 'minus'
  if (n === 'loyal' || n === 'loyalty') return 'loyalty'
  return 'other'
}

const BG = { plus: 'var(--lk-counter-plus)', minus: 'var(--lk-counter-minus)', other: 'var(--lk-counter-other)', loyalty: 'var(--lk-counter-other)' }

const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()

/** A counter on a card: +N / −N gems for P/T counters, a named chip for the rest. */
export const CounterGem = memo(function CounterGem({ name, count, size = 13 }: { name: string; count: number; size?: number }) {
  const k = counterKind(name)
  const text = k === 'plus' ? `+${count}` : k === 'minus' ? `−${count}` : count > 1 ? `${label(name)} ${count}` : label(name)
  return (
    <span
      className={k === 'other' ? 'lk-text' : 'lk-title'}
      title={`${count} ${name} counter${count === 1 ? '' : 's'}`}
      style={{
        display: 'inline-block', padding: `0 ${size * 0.5}px`, borderRadius: 999, background: BG[k], color: 'var(--lk-parchment)',
        fontWeight: k === 'other' ? 700 : 900, fontSize: k === 'other' ? size * 1.02 : size, lineHeight: `${size * 1.45}px`, whiteSpace: 'nowrap',
        boxShadow: `0 0 0 1.5px var(--lk-ink), inset 0 1px 0 rgb(255 255 255 / .28), inset 0 -2px 0 rgb(0 0 0 / .25)${k === 'other' ? ', inset 0 0 0 1px var(--lk-metal-line)' : ''}`,
      }}
    >
      {text}
    </span>
  )
})
