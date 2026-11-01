import type { EntityRef, StackItemDto } from '../protocol'
import { useShallow } from 'zustand/react/shallow'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { Icon, MARK_GLYPH } from '../look/glyphs'
import { usePeek } from '../popover/usePeek'
import { useBoardUi } from './uiStore'

/**
 * The stack, under the timeline in the right-hand column: the top of the stack first, right under the
 * timeline's "Now", so what resolves next is what joins the timeline next. Every item in full: who put it
 * there, its card, the whole text of what will happen and what it targets. Hover an item for its card.
 */
export function StackPanel() {
  const stack = useForge((s) => s.stack)
  if (!stack.length) return null
  return (
    <div className="lk-text" style={{ flex: 'none', maxHeight: '58%', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--lk-metal-line)', paddingTop: 8 }}>
      <div className="lk-title" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>The stack</span>
        <span style={{ fontSize: 11.5, color: 'var(--lk-parchment-mute)' }}>top resolves first</span>
      </div>
      <div className="bf-scroll" style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 2 }}>
        {stack.map((item, i) => <StackItem key={item.id} item={item} next={i === 0} />)}
      </div>
    </div>
  )
}

function StackItem({ item, next }: { item: StackItemDto; next: boolean }) {
  const source = useForge((s) => (item.sourceCardId != null ? s.cards[item.sourceCardId] : undefined))
  const peek = usePeek({ kind: 'card', id: item.sourceCardId ?? -1 })
  const who = useForge((s) => (item.activatorId == null ? '' : s.game?.localPlayerIds.includes(item.activatorId) ? 'You' : s.players[item.activatorId]?.name ?? ''))
  const targets = useForge(useShallow((s) => item.targets.map((t: EntityRef) => (t.kind === 'player' ? (s.game?.localPlayerIds.includes(t.id) ? 'you' : s.players[t.id]?.name) : s.cards[t.id]?.name) ?? '?')))
  const hovered = useBoardUi((s) => s.hoverStackId === item.id)
  const setHoverStack = useBoardUi((s) => s.setHoverStack)
  const kind = item.isTrigger ? 'Trigger' : item.isAbility ? 'Ability' : 'Spell'
  const tone = item.isTrigger ? 'var(--lk-gold)' : item.isAbility ? 'var(--lk-frost)' : 'var(--lk-parchment)'
  // The engine writes "Card name - what it does"; the name is already in the header.
  // The targets have their own line, so the engine's "(Targeting: ...)" tail goes.
  const named = source && item.text.startsWith(`${source.name} - `) ? item.text.slice(source.name.length + 3) : item.text
  const text = named.replace(/\s*\(Targeting:[^)]*\)\s*$/, '')
  return (
    <div
      data-entity={`stack:${item.id}`}
      onMouseEnter={() => setHoverStack(item.id)}
      onMouseLeave={() => setHoverStack(null)}
      style={{
        flex: 'none', padding: '8px 10px 9px', borderRadius: 6, background: 'linear-gradient(var(--lk-plate-top), var(--lk-ink-2))',
        boxShadow: `inset 0 0 0 1.5px ${hovered ? 'var(--lk-gold)' : next ? 'var(--lk-metal)' : 'var(--lk-metal-line)'}`,
      }}
    >
      <div className="lk-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: tone }}>
        {item.isTrigger && <Icon g={MARK_GLYPH.trigger} size={11} color={tone} />}
        <span style={{ fontWeight: 700 }}>{kind}</span>
        {who && <span style={{ color: 'var(--lk-parchment-dim)', textTransform: 'none', letterSpacing: 0 }}>· {who}</span>}
        {next && <span style={{ marginLeft: 'auto', color: 'var(--lk-parchment-mute)', textTransform: 'none', letterSpacing: 0 }}>resolves next</span>}
      </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 6, alignItems: 'flex-start' }}>
        <div {...(source ? peek : {})} data-entity={source ? `card:${source.id}` : undefined}
          style={{ flex: 'none', width: 46, height: 46 * (88 / 63), overflow: 'hidden', borderRadius: 4, cursor: source ? 'help' : undefined, boxShadow: '0 0 0 1px var(--lk-metal-line)' }}>
          {source ? <CardImage card={source} width={46} bare /> : <div style={{ width: '100%', height: '100%', background: 'var(--lk-ink-3)' }} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="lk-title" style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.15, color: 'var(--lk-parchment)' }}>{source?.name ?? 'Ability'}</div>
          {source?.typeLine && <div style={{ fontSize: 11.5, color: 'var(--lk-parchment-mute)', marginTop: 1 }}>{source.typeLine}</div>}
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: 'var(--lk-parchment-dim)', whiteSpace: 'pre-line' }}>{text}</div>
      {targets.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--lk-ember-light)' }}>
          Targets <b className="lk-title">{targets.join(', ')}</b>
        </div>
      )}
    </div>
  )
}
