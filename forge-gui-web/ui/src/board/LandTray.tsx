import { memo } from 'react'
import { ManaSymbol } from '../look/ManaSymbol'
import { usePeek } from '../popover/usePeek'
import type { TrayGroup } from './lands'

const FILL: Record<string, string> = {
  W: 'var(--lk-mana-w)', U: 'var(--lk-mana-u)', B: 'var(--lk-mana-b)', R: 'var(--lk-mana-r)', G: 'var(--lk-mana-g)', C: 'var(--lk-mana-c)',
}

/**
 * Your lands, the way they sit on a real table: a stack of small land tiles per kind of mana, untapped
 * ones upright, tapped ones turned sideways beside them. Lands with an ability and mana rocks keep their
 * name. `usable`: you can spend mana now (untapped stacks glow frost). Clicking a stack selects a land in it.
 */
export const LandTray = memo(function LandTray({ groups, usable, compact, onPick, align = 'start' }: {
  groups: TrayGroup[]
  usable?: boolean
  compact?: boolean
  onPick?: (ids: number[]) => void
  align?: 'start' | 'center'
}) {
  if (!groups.length) return null
  const w = compact ? 20 : 28
  return (
    <div
      style={{
        display: 'inline-flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: align === 'start' ? 'flex-start' : 'center', maxWidth: '100%',
        gap: compact ? '4px 10px' : '6px 16px', padding: compact ? '4px 8px' : '5px 12px 4px', borderRadius: 8,
        background: 'var(--lk-ribbon)', boxShadow: '0 0 0 1px var(--lk-metal-line), 0 6px 14px rgb(0 0 0 / .45)',
      }}
    >
      {groups.map((g) => <Stack key={g.key} g={g} w={w} usable={usable} compact={compact} onPick={onPick} />)}
    </div>
  )
})

function Stack({ g, w, usable, compact, onPick }: { g: TrayGroup; w: number; usable?: boolean; compact?: boolean; onPick?: (ids: number[]) => void }) {
  const ids = [...g.open, ...g.tapped]
  const peek = usePeek({ kind: 'card', id: ids[0] })
  const h = Math.round(w * 1.36)
  const n = g.open.length
  const t = g.tapped.length
  const count = (k: number, dim: boolean) => (
    <b className="lk-title" style={{ fontSize: compact ? 13 : 17, fontWeight: 700, lineHeight: 1, color: dim ? 'var(--lk-parchment-mute)' : 'var(--lk-parchment)' }}>{k}</b>
  )
  return (
    <span
      {...peek}
      title={`${g.name ?? g.sym}: ${n} untapped${t ? `, ${t} tapped` : ''}`}
      onClick={onPick ? () => onPick(g.open.length ? g.open : g.tapped) : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 4 : 6, cursor: onPick ? 'pointer' : undefined }}
    >
      {n > 0 && (
        <>
          <span style={{ position: 'relative', width: w + Math.min(n - 1, 2) * 3, height: h }}>
            {Array.from({ length: Math.min(n, 3) }, (_, i) => (
              <Tile key={i} sym={g.sym} w={w} h={h} style={{ left: (Math.min(n, 3) - 1 - i) * 3, top: 0 }} glow={i === Math.min(n, 3) - 1 && usable} />
            ))}
          </span>
          {count(n, false)}
        </>
      )}
      {t > 0 && (
        <>
          <span className="lk-fade" style={{ position: 'relative', width: h, height: h, opacity: 0.5, marginLeft: n ? 2 : 0 }}>
            <Tile sym={g.sym} w={w} h={h} style={{ left: (h - w) / 2, top: 0, transform: 'rotate(90deg)' }} />
          </span>
          {count(t, true)}
        </>
      )}
      {g.name && (
        <span className="lk-text" style={{ fontSize: compact ? 11 : 13, fontWeight: 600, color: 'var(--lk-parchment-dim)', maxWidth: compact ? 70 : 130, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
      )}
    </span>
  )
}

function Tile({ sym, w, h, style, glow }: { sym: string; w: number; h: number; style: React.CSSProperties; glow?: boolean }) {
  const tone = FILL[sym[0]] ?? FILL.C
  return (
    <span
      style={{
        position: 'absolute', width: w, height: h, borderRadius: Math.max(3, w * 0.14), display: 'grid', placeItems: 'center', boxSizing: 'border-box',
        background: `linear-gradient(color-mix(in srgb, ${tone} 34%, #17120d), color-mix(in srgb, ${tone} 12%, #0e0b08))`,
        boxShadow: glow ? '0 0 0 1.5px var(--lk-frost), 0 0 10px 1px var(--lk-frost-soft)' : '0 0 0 1px var(--lk-ink), 0 0 0 2px var(--lk-metal-line), 0 2px 4px rgb(0 0 0 / .5)',
        ...style,
      }}
    >
      <ManaSymbol sym={sym} size={Math.round(w * 0.7)} shadow={false} />
    </span>
  )
}
