import type { CardDto, EntityRef, StackItemDto } from '../protocol'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { Icon, MARK_GLYPH } from '../look/glyphs'
import { usePeek } from '../popover/usePeek'
import { useBoardUi } from './uiStore'
import { MoreTime } from './Callouts'
import { abilityText, usePhaseLine, usePrompt, useRespondCountdown } from './situation'
import { Face } from './Face'
import { useSeatColors } from './Seat'

/**
 * Bottom of the right-hand column: always on. Phase, the current ask, and the whole stack with
 * each item's card and its targets — so you do not have to chase arrows to know what is happening.
 */
export function Dock() {
  const { who, step } = usePhaseLine()
  const { text, waiting } = usePrompt()
  const left = useRespondCountdown()
  return (
    <div className="lk-text" style={{ flex: 'none', maxHeight: '64%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: '1px solid var(--lk-metal-line)' }}>
      <div className="lk-title" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{who}</span>
        {step && <span style={{ fontSize: 12.5, color: 'var(--lk-parchment-dim)' }}>{step}</span>}
      </div>
      <div
        className="lk-text"
        style={{
          position: 'relative', flex: 'none', padding: '8px 10px 9px 13px', borderRadius: 5,
          background: waiting ? 'rgb(18 14 10 / .92)' : 'linear-gradient(rgb(245 213 138 / .14), rgb(245 213 138 / .05)), rgb(18 14 10 / .96)',
          boxShadow: waiting ? '0 0 0 1px var(--lk-metal-line)' : '0 0 0 1px var(--lk-gold-soft)',
        }}
      >
        <span aria-hidden style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: waiting ? 'var(--lk-parchment-mute)' : 'var(--lk-gold)' }} />
        <div className="lk-label" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: waiting ? 'var(--lk-parchment-dim)' : 'var(--lk-gold)' }}>
          <span>{waiting ? 'Waiting' : 'Your move'}</span>
          {left != null && !waiting && <span style={{ marginLeft: 'auto', color: left <= 3 ? 'var(--lk-ember-light)' : 'var(--lk-parchment-dim)', fontVariantNumeric: 'tabular-nums' }}>{left}s</span>}
          {left != null && !waiting && <MoreTime />}
        </div>
        <div className="lk-title" style={{ marginTop: 3, fontWeight: 700, fontSize: waiting ? 14.5 : 16.5, lineHeight: 1.25, color: waiting ? 'var(--lk-parchment-dim)' : 'var(--lk-parchment)' }}>
          {text || 'The table is quiet'}
        </div>
      </div>
      <StackList />
    </div>
  )
}

function StackList() {
  const stack = useForge((s) => s.stack)
  return (
    <div style={{ minHeight: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
      <div className="lk-title" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>The stack</span>
        <span style={{ fontSize: 11.5, color: 'var(--lk-parchment-mute)' }}>{stack.length ? 'top resolves first' : 'empty · nothing to resolve'}</span>
      </div>
      {stack.length ? (
        <div className="bf-scroll" style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 2 }}>
          {stack.map((item, i) => <StackItem key={item.id} item={item} next={i === 0} />)}
        </div>
      ) : (
        <div style={{ padding: '8px 6px', borderRadius: 5, border: '1px dashed var(--lk-metal-faint)', fontSize: 12.5, color: 'var(--lk-parchment-mute)' }}>
          Spells and abilities will pile here. The top one resolves first.
        </div>
      )}
    </div>
  )
}

function StackItem({ item, next }: { item: StackItemDto; next: boolean }) {
  const source = useForge((s) => (item.sourceCardId != null ? s.cards[item.sourceCardId] : undefined))
  const peek = usePeek({ kind: 'card', id: item.sourceCardId ?? -1 })
  const who = useForge((s) => (item.activatorId == null ? '' : s.game?.localPlayerIds.includes(item.activatorId) ? 'You' : s.players[item.activatorId]?.name ?? ''))
  const hovered = useBoardUi((s) => s.hoverStackId === item.id)
  const setHoverStack = useBoardUi((s) => s.setHoverStack)
  const kind = item.isTrigger ? 'Trigger' : item.isAbility ? 'Ability' : 'Spell'
  const tone = item.isTrigger ? 'var(--lk-gold)' : item.isAbility ? 'var(--lk-frost)' : 'var(--lk-parchment)'
  const { text } = abilityText(item.text, source?.name)
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
        <div {...(source ? peek : {})} style={{ flex: 'none', width: 46, overflow: 'hidden', borderRadius: 4, cursor: source ? 'help' : undefined, boxShadow: '0 0 0 1px var(--lk-metal-line)' }}>
          {source ? <CardImage card={source} width={46} bare /> : <div style={{ width: 46, height: 64, background: 'var(--lk-ink-3)' }} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="lk-title" style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.15, color: 'var(--lk-parchment)' }}>{source?.name ?? 'Ability'}</div>
          {source?.typeLine && <div style={{ fontSize: 11.5, color: 'var(--lk-parchment-mute)', marginTop: 1 }}>{source.typeLine}</div>}
          {text && <div style={{ marginTop: 5, fontSize: 12.5, lineHeight: 1.4, color: 'var(--lk-parchment-dim)', whiteSpace: 'pre-line' }}>{text}</div>}
        </div>
      </div>
      <Targets refs={item.targets} />
    </div>
  )
}

function Targets({ refs }: { refs: EntityRef[] }) {
  if (!refs.length) {
    return <div style={{ marginTop: 6, fontSize: 12, color: 'var(--lk-parchment-mute)' }}>No targets</div>
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div className="lk-label" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--lk-ember-light)', marginBottom: 5 }}>
        {refs.length === 1 ? 'Target' : `Targets · ${refs.length}`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {refs.map((t, i) => <TargetChip key={`${t.kind}:${t.id}:${i}`} entity={t} />)}
      </div>
    </div>
  )
}

function TargetChip({ entity }: { entity: EntityRef }) {
  if (entity.kind === 'player') return <PlayerChip id={entity.id} />
  return <CardChip id={entity.id} />
}

function CardChip({ id }: { id: number }) {
  const card = useForge((s) => s.cards[id] as CardDto | undefined)
  const peek = usePeek({ kind: 'card', id })
  const ctl = useForge((s) => {
    const c = s.cards[id]
    if (!c) return ''
    return s.game?.localPlayerIds.includes(c.controllerId) ? 'you' : s.players[c.controllerId]?.name ?? ''
  })
  if (!card) {
    return <div style={{ fontSize: 12.5, color: 'var(--lk-parchment-dim)' }}>Unknown card</div>
  }
  return (
    <div {...peek} data-ghost="" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 6px', borderRadius: 4, background: 'rgb(10 8 6 / .45)', boxShadow: 'inset 0 0 0 1px var(--lk-ember-line)', cursor: 'help' }}>
      <div style={{ flex: 'none', width: 28, overflow: 'hidden', borderRadius: 3 }}>
        <CardImage card={card} width={28} bare />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="lk-title" style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.15, color: 'var(--lk-parchment)' }}>{card.name}</div>
        <div style={{ fontSize: 11, color: 'var(--lk-parchment-mute)' }}>{[card.power != null ? `${card.power}/${card.toughness}` : null, ctl && `controlled by ${ctl}`].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  )
}

function PlayerChip({ id }: { id: number }) {
  const player = useForge((s) => s.players[id])
  const mine = useForge((s) => !!s.game?.localPlayerIds.includes(id))
  const colors = useSeatColors(player)
  const peek = usePeek({ kind: 'player', id })
  if (!player) return <div style={{ fontSize: 12.5, color: 'var(--lk-parchment-dim)' }}>Unknown player</div>
  return (
    <div {...peek} data-ghost="" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 6px', borderRadius: 4, background: 'rgb(10 8 6 / .45)', boxShadow: 'inset 0 0 0 1px var(--lk-ember-line)', cursor: 'help' }}>
      <Face player={player} colors={colors} size={28} />
      <div className="lk-title" style={{ fontWeight: 700, fontSize: 13, color: 'var(--lk-parchment)' }}>
        {mine ? 'You' : player.name} <span style={{ fontWeight: 500, color: 'var(--lk-parchment-dim)' }}>· {player.life} life</span>
      </div>
    </div>
  )
}
