import { memo } from 'react'
import './theme'

export type PTTone = 'printed' | 'raised' | 'lowered'
export type BasePT = { power: number; toughness: number }

/**
 * Parchment when printed, frost when raised, ember when damaged or lowered. Comparing needs the base
 * (printed) P/T, which CardDto doesn't carry yet (server: basePower/baseToughness). Without it only
 * damage can be shown.
 */
export function ptTone(power: number, toughness: number, damage = 0, base?: BasePT | null): PTTone {
  if (damage > 0) return 'lowered'
  if (!base) return 'printed'
  if (power < base.power || toughness < base.toughness) return 'lowered'
  if (power > base.power || toughness > base.toughness) return 'raised'
  return 'printed'
}

const BG: Record<PTTone, string> = { printed: 'var(--lk-parchment-plate)', raised: 'var(--lk-frost-plate)', lowered: 'var(--lk-ember-plate)' }

export const PTPlate = memo(function PTPlate({ power, toughness, damage = 0, base, size = 15 }: {
  power: number
  toughness: number
  damage?: number
  base?: BasePT | null
  size?: number
}) {
  const tone = ptTone(power, toughness, damage, base)
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {damage > 0 && (
        <span
          className="lk-title"
          title={`${damage} damage marked`}
          style={{
            position: 'absolute', right: '100%', marginRight: -size * 0.25, top: '50%', transform: 'translateY(-50%)',
            padding: `0 ${size * 0.3}px 0 ${size * 0.35}px`, borderRadius: `${size * 0.35}px 0 0 ${size * 0.35}px`,
            background: 'var(--lk-mythic-bottom)', color: 'var(--lk-on-ember)', fontWeight: 900, fontSize: size * 0.72, lineHeight: `${size * 1.25}px`,
            boxShadow: '0 0 0 1.5px var(--lk-on-parchment)', whiteSpace: 'nowrap',
          }}
        >
          {damage} dmg
        </span>
      )}
      <span
        className="lk-title"
        style={{
          position: 'relative', minWidth: size * 2.3, textAlign: 'center', padding: `${size * 0.05}px ${size * 0.4}px`, borderRadius: size * 0.4,
          background: BG[tone], color: 'var(--lk-on-parchment)', fontWeight: 900, fontSize: size, lineHeight: 1.2,
          boxShadow: '0 0 0 1.5px var(--lk-on-parchment), inset 0 1px 0 rgb(255 255 255 / .45), 0 3px 6px rgb(0 0 0 / .6)', whiteSpace: 'nowrap',
        }}
      >
        {power}/{toughness}
      </span>
    </span>
  )
})
