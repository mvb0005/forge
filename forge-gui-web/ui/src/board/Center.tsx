import type { StackItemDto } from '../protocol'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { Icon, MARK_GLYPH } from '../look/glyphs'
import { STACK, stackItemY } from '../table/frame'
import { usePeek } from '../popover/usePeek'
import { useBoardUi } from './uiStore'

/** The stack beside the type line, top of the stack nearest the line. Hover an item to see its source and targets. */
export function StackView({ h }: { h: number }) {
  const stack = useForge((s) => s.stack)
  if (!stack.length) return null
  return (
    <div className="lk-text" style={{ position: 'relative', height: h }}>
      {stack.slice(0, STACK.shown).map((item, i) => (
        <StackItem key={item.id} item={item} top={i === 0} y={h - stackItemY(i)} />
      ))}
      {stack.length > STACK.shown && (
        <span className="lk-label" style={{ position: 'absolute', left: 0, top: 0, fontSize: 13, color: 'var(--lk-parchment-dim)' }}>+{stack.length - STACK.shown} more</span>
      )}
    </div>
  )
}

// Spells on the stack draw their own card in the thumbnail slot (card layer); abilities show their source.
function StackItem({ item, top, y }: { item: StackItemDto; top: boolean; y: number }) {
  const source = useForge((s) => (item.sourceCardId != null ? s.cards[item.sourceCardId] : undefined))
  const own = source?.zone === 'stack'
  const peek = usePeek({ kind: 'card', id: item.sourceCardId ?? -1 })
  const activator = useForge((s) => (item.activatorId != null ? s.players[item.activatorId] : undefined))
  const hovered = useBoardUi((s) => s.hoverStackId === item.id)
  const setHoverStack = useBoardUi((s) => s.setHoverStack)
  const kind = item.isTrigger ? 'Trigger' : item.isAbility ? 'Ability' : 'Spell'
  const tone = item.isTrigger ? 'var(--lk-gold)' : item.isAbility ? 'var(--lk-frost)' : 'var(--lk-parchment-dim)'
  return (
    <div
      data-entity={`stack:${item.id}`}
      style={{
        position: 'absolute', left: 0, right: 0, top: y, height: STACK.itemH, display: 'flex', alignItems: 'center', gap: 9, padding: `0 10px 0 ${STACK.thumbX}px`, borderRadius: 10,
        background: 'linear-gradient(var(--lk-plate-top), var(--lk-ink-2))', opacity: top || hovered ? 1 : 0.86,
        boxShadow: `0 0 0 1.5px var(--lk-ink), 0 0 0 2.5px ${hovered ? 'var(--lk-gold)' : top ? 'var(--lk-metal)' : 'var(--lk-metal-line)'}, 0 8px 18px rgb(0 0 0 / .5)`,
      }}
      onMouseEnter={() => setHoverStack(item.id)}
      onMouseLeave={() => setHoverStack(null)}
    >
      <div style={{ flex: 'none', width: STACK.thumbW, height: STACK.thumbW * (88 / 63), overflow: 'hidden', borderRadius: 4 }} {...(source && !own ? peek : {})}>
        {own ? null : source ? <CardImage card={source} width={STACK.thumbW} bare /> : <div style={{ width: '100%', height: '100%', background: 'var(--lk-ink-3)' }} />}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="lk-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 13, color: tone }}>
            {item.isTrigger && <Icon g={MARK_GLYPH.trigger} size={11} color={tone} />}
            {kind}
          </span>
          <span className="lk-title" style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source?.name ?? ''}</span>
        </div>
        <div title={`${activator?.name ?? ''}: ${item.text}`} style={{ fontSize: 11.5, lineHeight: 1.25, color: 'var(--lk-parchment-dim)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {item.text}
        </div>
      </div>
    </div>
  )
}
