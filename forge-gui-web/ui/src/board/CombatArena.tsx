import type { MouseEvent } from 'react'
import { Icon, MARK_GLYPH } from '../look/glyphs'
import { send } from '../net'
import type { LayoutResult } from '../table/contract'
import { useForge } from '../store'
import { CARD_RATIO } from './layout'
import { PAD } from './fieldLayout'

// Block slots while you declare blockers: under each attacker coming at you that nothing blocks yet,
// on your side of the line, saying what it takes to block it and what gets through if you don't.
// The words are the blockers assist's reasons and the damage is the combat assist's; no rules here.

type Slot = { key: string; attackerId: number; x: number; y: number; w: number; h: number; laneX: number; laneY: number; laneW: number; rule: string; through: string | null }

function mostCommon(xs: string[]) {
  const n = new Map<string, number>()
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0]
}

export function BlockSlots({ layout }: { layout: LayoutResult }) {
  const bA = useForge((s) => s.blockersAssist)
  const assist = useForge((s) => s.combatAssist)
  const combat = useForge((s) => s.combat)
  const highlighted = useForge((s) => s.highlighted)
  if (!bA?.attackers.length || !combat) return null
  const bottom = layout.regions.bottom
  const blockers = new Map(combat.bands.flatMap((b) => b.attackerIds.map((id) => [id, new Set([...b.blockerIds, ...b.plannedBlockerIds]).size] as const)))
  const slots: Slot[] = []
  for (const key of Object.keys(layout.regions)) {
    if (!key.startsWith('lane:col:')) continue
    const head = Number(key.slice(9))
    const p = layout.placements.get(head)
    if (!p || p.edge !== 'bottom') continue // only attackers on the opponent's side come at you
    const ids = [head, ...(p.memberIds ?? [])]
    const have = Math.max(0, ...ids.map((id) => blockers.get(id) ?? 0))
    const entry = bA.attackers.find((a) => ids.includes(a.attackerId))
    if (!entry) continue
    const h = p.w * CARD_RATIO
    const dmg = ids.reduce((n, id) => n + (assist?.attackers.find((a) => a.id === id)?.damage ?? 0), 0)
    // The attacker's own rule (evasion, menace) teaches more than a bare "Block", even when someone can block it.
    const rule = mostCommon(entry.cannotBlock.map((c) => c.reason).filter((r) => r.includes(':'))) ?? (entry.canBlock.length ? 'Block' : (mostCommon(entry.cannotBlock.map((c) => c.reason)) ?? 'No blockers'))
    const lane = layout.regions[key]
    const base = { attackerId: entry.attackerId, y: bottom.y + PAD + 1, w: p.w, h, laneX: p.x, laneY: p.y, laneW: lane.w, through: dmg > 0 ? `else ${dmg} to you` : null }
    // Menace lanes always show two slots (D-11); the second one says what it's for.
    const n = Math.max(1, entry.minBlockers)
    for (let i = have; i < n; i++) {
      const x = n > 1 ? p.x + (i * (lane.w - p.w)) / (n - 1) : p.x
      slots.push({ ...base, key: `${entry.attackerId}:${i}`, x, rule: i === 0 ? rule : entry.minBlockers === 2 ? 'Menace · needs a second blocker' : `Blocker ${i + 1} of ${n}`, through: i === 0 ? base.through : null })
    }
  }
  return (
    <>
      {slots.map((s) => {
        const focus = highlighted.has(`card:${s.attackerId}`)
        const fs = Math.max(11, s.w * 0.1)
        return (
          <div key={s.key}>
            {focus && s === slots.find((o) => o.attackerId === s.attackerId) && (
              <div
                className="pointer-events-none"
                style={{ position: 'absolute', left: s.laneX - 14, top: s.laneY - 12, width: s.laneW + 28, height: s.y + s.h + 12 - (s.laneY - 12), borderRadius: 14, zIndex: 5, boxShadow: '0 0 0 2px var(--lk-gold), 0 0 34px rgb(245 213 138 / .22)', background: 'rgb(245 213 138 / .05)' }}
              />
            )}
            <button
              type="button"
              data-block-slot={s.attackerId}
              title={focus ? 'Now choose a creature to block with' : 'Click to block this attacker'}
              onClick={(e: MouseEvent) => {
                e.stopPropagation()
                send({ t: 'selectCard', cardId: s.attackerId, shift: false, button: 1 })
              }}
              className="lk-title"
              style={{
                position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, zIndex: 6, boxSizing: 'border-box', borderRadius: 9, cursor: 'pointer',
                border: `2px dashed ${focus ? 'var(--lk-gold)' : 'rgb(143 180 227 / .65)'}`, background: 'rgb(10 8 6 / .5)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center', padding: 8,
                color: focus ? '#f7e3b0' : 'var(--lk-steel-text)', fontWeight: 700, fontSize: fs, lineHeight: 1.2,
              }}
            >
              <Icon g={MARK_GLYPH.block} size={Math.max(16, s.w * 0.16)} color="currentColor" />
              {s.rule.replace(': ', ' · ')}
              {s.through && <span className="lk-text" style={{ fontSize: fs * 1.12, fontWeight: 600, color: 'var(--lk-ember-light)' }}>{s.through}</span>}
            </button>
          </div>
        )
      })}
    </>
  )
}
