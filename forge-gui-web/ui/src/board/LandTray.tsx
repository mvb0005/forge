import { useState } from 'react'
import { ManaRibbon, type RibbonSource } from '../look/ManaRibbon'
import { ManaSymbol } from '../look/ManaSymbol'
import { usePeek } from '../popover/usePeek'
import type { LandChip } from './lands'

/** The mana ribbon. Lands with an ability stay in the pips until the row is opened. */
export function ManaRow({ sources, extras, usable, onPick, align = 'center' }: {
  sources: RibbonSource[]
  extras: LandChip[]
  usable?: boolean
  onPick?: (ids: number[]) => void
  align?: 'start' | 'center'
}) {
  const [open, setOpen] = useState(false)
  if (!sources.length && !extras.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'start' ? 'flex-start' : 'center', gap: 4, maxWidth: '100%' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
        <ManaRibbon sources={sources} usable={usable} size={22} onPick={onPick ? (s) => s.ids && onPick(s.ids) : undefined} />
        {extras.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'var(--lk-parchment-dim)', font: 'inherit', fontSize: 12 }}
          >
            {open ? 'less' : 'more'}
          </button>
        )}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {extras.map((chip) => (
            <Ability key={chip.key} chip={chip} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  )
}

function Ability({ chip, onPick }: { chip: LandChip; onPick?: (ids: number[]) => void }) {
  const peek = usePeek({ kind: 'card', id: chip.ids[0] })
  return (
    <button
      type="button"
      {...peek}
      onClick={onPick ? () => onPick(chip.ids) : undefined}
      style={{ display: 'flex', alignItems: 'baseline', gap: 6, maxWidth: 420, border: 0, background: 'none', padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit', cursor: onPick ? 'pointer' : 'default' }}
    >
      <ManaSymbol sym={chip.sym} size={12} shadow={false} />
      <b style={{ fontSize: 12, fontWeight: 650, whiteSpace: 'nowrap' }}>{chip.name}</b>
      <span style={{ fontSize: 12, color: 'var(--lk-parchment-dim)' }}>{chip.ability}</span>
    </button>
  )
}
