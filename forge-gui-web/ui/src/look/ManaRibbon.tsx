import { memo } from 'react'
import './theme'
import type { CardDto } from '../protocol'
import { ManaSymbol } from './ManaSymbol'
import { identity } from './tones'
import type { Sym } from './mana'

export type RibbonSource = { sym: Sym; untapped: number; total: number; label?: string; ids?: number[] }

const BASIC: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G', Wastes: 'C' }

export function landSym(c: CardDto): { sym: Sym; label?: string } {
  const basics = Object.keys(BASIC).filter((b) => c.typeLine.includes(b))
  let cs = basics.map((b) => BASIC[b])
  if (!cs.length) {
    if (/any colou?r/i.test(c.text)) return { sym: 'C', label: 'Any' }
    const made = new Set<string>()
    for (const m of c.text.matchAll(/Add ((?:\{[WUBRGC]\}(?:,? (?:or )?)?)+)/g)) for (const s of m[1].matchAll(/\{([WUBRGC])\}/g)) made.add(s[1])
    cs = [...identity(made), ...(made.has('C') ? ['C'] : [])]
  }
  if (cs.length === 0) return { sym: 'C', label: c.name }
  if (cs.length === 2) return { sym: cs.join('/') }
  if (cs.length > 2) return { sym: 'C', label: 'Tri' }
  return { sym: cs[0] }
}

/** Folds a player's lands into ribbon sources by the mana symbol they make (presentation, from type line and text). */
export function foldLands(cards: CardDto[]): RibbonSource[] {
  const by = new Map<string, RibbonSource>()
  for (const c of cards) {
    if (!c.types.includes('Land')) continue
    const { sym, label } = landSym(c)
    const key = sym + (label ?? '')
    const s = by.get(key) ?? { sym, label, untapped: 0, total: 0, ids: [] }
    s.total++
    if (!c.tapped) s.untapped++
    s.ids!.push(c.id)
    by.set(key, s)
  }
  const order = 'WUBRGC'
  return [...by.values()].sort((a, b) => order.indexOf(a.sym[0]) - order.indexOf(b.sym[0]))
}

/**
 * Lands folded into mana symbols with counts. `usable`: you can spend untapped mana now (they glow frost).
 * Tapped-out sources fade. Extra sources (mana rocks) go in as their own entries with a label. `onPick`: a source was clicked.
 */
export const ManaRibbon = memo(function ManaRibbon({ sources, usable = false, size = 26, summary, onPick }: { sources: RibbonSource[]; usable?: boolean; size?: number; summary?: string; onPick?: (s: RibbonSource) => void }) {
  if (!sources.length) return null
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: size * 0.55, padding: `${size * 0.22}px ${size * 0.55}px`, borderRadius: 999,
        background: 'var(--lk-ribbon)', boxShadow: '0 0 0 1px var(--lk-metal-line), 0 6px 14px rgb(0 0 0 / .45)',
      }}
    >
      {sources.map((s, i) => {
        const open = s.untapped > 0
        return (
          <span
            key={i}
            className="lk-fade"
            title={`${s.label ?? s.sym}: ${s.untapped} of ${s.total} untapped`}
            style={{ display: 'flex', alignItems: 'center', gap: size * 0.22, opacity: open ? 1 : 0.42, cursor: onPick && s.ids?.length ? 'pointer' : undefined }}
            onClick={onPick && s.ids?.length ? () => onPick(s) : undefined}
          >
            <span style={{ position: 'relative', display: 'grid', width: size, height: size }}>
              {usable && open && <span className="lk-glow" style={{ position: 'absolute', inset: -1, borderRadius: 999, boxShadow: '0 0 0 2px var(--lk-frost), 0 0 12px 2px var(--lk-frost-soft)' }} />}
              <ManaSymbol sym={s.sym} size={size} shadow={false} />
            </span>
            <b className="lk-title" style={{ fontSize: size * 0.66, fontWeight: 700, color: 'var(--lk-parchment)', lineHeight: 1 }}>
              {s.untapped}
              {s.untapped !== s.total && <span style={{ fontSize: '0.62em', color: 'var(--lk-parchment-mute)', fontWeight: 500 }}>/{s.total}</span>}
            </b>
            {s.label && <span className="lk-text" style={{ fontSize: size * 0.6, color: 'var(--lk-parchment-dim)', fontWeight: 600 }}>{s.label}</span>}
          </span>
        )
      })}
      {summary && <span className="lk-text" style={{ fontSize: size * 0.58, color: 'var(--lk-parchment-dim)', whiteSpace: 'nowrap' }}>{summary}</span>}
    </div>
  )
})
