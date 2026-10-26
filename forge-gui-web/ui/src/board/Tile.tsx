import { useMemo, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Highlight } from '../look/CardFrame'
import { Icon, MARK_GLYPH } from '../look/glyphs'
import type { BasePT } from '../look/PTPlate'
import { send } from '../net'
import type { CardDto } from '../protocol'
import { useForge, type ForgeState } from '../store'
import { combatRoles, pickFromGroup } from './layout'
import { useBoardUi } from './uiStore'

export function clickCards(e: MouseEvent, ids: number[]) {
  e.preventDefault()
  e.stopPropagation()
  const s = useForge.getState()
  const { cardId, others } = pickFromGroup(ids, s.cards, s.selectable.cardIds, s.playable, s.highlighted)
  const button = e.type === 'contextmenu' || e.button === 2 ? 3 : 1
  send({ t: 'selectCard', cardId, others: e.shiftKey && others.length ? others : undefined, shift: e.shiftKey, button })
}

function highlightOf(s: ForgeState, ids: number[], hoverStackId: number | null): Highlight | null {
  const some = (f: (id: number) => boolean) => ids.some(f)
  const hovered = hoverStackId != null ? s.stack.find((i) => i.id === hoverStackId) : undefined
  const top = s.stack[0]
  const aimed = (item: typeof top | undefined) => !!item && some((id) => item.targets.some((t) => t.kind === 'card' && t.id === id))
  if (aimed(hovered) || aimed(top) || (hovered && some((id) => hovered.sourceCardId === id))) return 'targeted'
  if (some((id) => s.highlighted.has(`card:${id}`))) return 'chosen'
  if (some((id) => s.selectable.cardIds.has(id))) return 'choose'
  const role = combatRoles(s.combat).get(ids[0])?.role
  if (role) return role === 'attacker' ? 'attacking' : 'blocking'
  if (canBlockNow(s, ids[0])) return 'choose'
  if (!s.selectable.cardIds.size && some((id) => s.playable.has(id))) return 'playable'
  return null
}

/** A legal blocker (blockers assist) for the current attacker, or for any attacker when none is chosen. */
function canBlockNow(s: ForgeState, id: number) {
  const a = s.blockersAssist?.attackers
  if (!a?.length) return false
  const focus = a.find((x) => s.highlighted.has(`card:${x.attackerId}`))
  return (focus ? [focus] : a).some((x) => x.canBlock.includes(id))
}

/** Why a creature of yours can't block right now (blockers assist), or null. For the current attacker when one is chosen. */
function cantBlock(s: ForgeState, id: number): string | null {
  const a = s.blockersAssist?.attackers
  if (!a?.length) return null
  const focus = a.find((x) => s.highlighted.has(`card:${x.attackerId}`))
  if (focus) return focus.cannotBlock.find((c) => c.id === id)?.reason ?? null
  if (a.some((x) => x.canBlock.includes(id))) return null
  for (const x of a) {
    const r = x.cannotBlock.find((c) => c.id === id)
    if (r) return r.reason
  }
  return null
}

function verdictOf(s: ForgeState, id: number): 'dies' | 'survives' | null {
  const a = s.combatAssist
  if (!a) return null
  const role = combatRoles(s.combat).get(id)
  if (!role) return null
  if ([...a.attackers, ...a.blockers].some((x) => x.id === id && x.dies)) return 'dies'
  if (role.role === 'blocker') return 'survives'
  const band = s.combat?.bands.find((b) => b.attackerIds.includes(id))
  return band && band.blockerIds.length + band.plannedBlockerIds.length > 0 ? 'survives' : null
}

type MaybeBase = { basePower?: number | null; baseToughness?: number | null }

/** How a card (or a group, by its ids) is drawn right now, mapped from the store. Every value is a primitive. */
export function useCardLook(ids: number[], card: CardDto | undefined) {
  const hs = useBoardUi((s) => s.hoverStackId)
  const highlight = useForge((s) => highlightOf(s, ids, hs))
  const dim = useForge((s) => cantBlock(s, ids[0]))
  const verdict = useForge((s) => verdictOf(s, ids[0]))
  const choosingTargets = useForge((s) => s.selectable.cardIds.size > 0)
  const bp = (card as MaybeBase | undefined)?.basePower
  const bt = (card as MaybeBase | undefined)?.baseToughness
  const base = useMemo((): BasePT | null => (bp != null && bt != null ? { power: bp, toughness: bt } : null), [bp, bt])
  return { highlight, dim, verdict, choosingTargets, base }
}

/** Cards exiled with a permanent, as a chip on it; names on hover. */
export function HeldExile({ ids }: { ids: number[] }) {
  const names = useForge(useShallow((s) => ids.map((id) => s.cards[id]?.name ?? 'Unknown card')))
  const [open, setOpen] = useState(false)
  return (
    <span
      className="lk-title pointer-events-auto"
      style={{ position: 'absolute', right: -8, top: 92, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 7px', borderRadius: 999, background: 'var(--lk-chip)', boxShadow: '0 0 0 1px var(--lk-metal-line)', color: 'var(--lk-parchment)', fontWeight: 700, fontSize: 14, lineHeight: '22px' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Icon g={MARK_GLYPH.exile} size={13} color="var(--lk-parchment-dim)" />
      {ids.length}
      {open && (
        <div className="bf-pop lk-text" style={{ position: 'absolute', left: '100%', top: 0, marginLeft: 6, zIndex: 50, width: 'max-content', maxWidth: 220, padding: 10, borderRadius: 10, background: 'var(--lk-panel)', boxShadow: '0 0 0 1px var(--lk-metal-line), 0 10px 24px rgb(0 0 0 / .6)', fontWeight: 400, fontSize: 14 }}>
          <div className="lk-label" style={{ fontSize: 13, color: 'var(--lk-parchment-dim)', marginBottom: 4 }}>Exiled with this</div>
          {names.map((n, i) => <div key={ids[i]}>{n}</div>)}
        </div>
      )}
    </span>
  )
}
