import { useEffect, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { stepWords } from '../look/phase'
import { usePopover } from '../popover/store'
import { usePeek } from '../popover/usePeek'
import type { CardDto, EntityRef, PlayerDto } from '../protocol'
import { send } from '../net'
import { useForge } from '../store'
import { CardImage } from './CardImage'
import { RulesText } from './mana'
import { useBoardUi } from './uiStore'

// What is happening to whom, beside each player's border (3-4 players): one callout per player with a part in
// it right now. Attacking and attacked (combat bands), blocking, casting and being targeted (the stack), and
// holding priority; yours also carries the engine's prompt and the respond countdown. Everything is read
// from what the engine sent: who is in combat, what is on the stack, whose priority it is.

type Tone = 'you' | 'ember' | 'steel' | 'frost' | 'plain'
export type Line = { key: string; tone: Tone; text: ReactNode }

const TONE: Record<Tone, string> = {
  you: 'var(--lk-gold)',
  ember: 'var(--lk-ember)',
  steel: 'var(--lk-steel)',
  frost: 'var(--lk-frost)',
  plain: 'var(--lk-metal-line)',
}

const B = ({ children }: { children: ReactNode }) => <b className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{children}</b>
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const shortName = (c: CardDto | undefined) => (c?.name || 'a card').split(',')[0]

type View = {
  meIds: number[]
  players: Record<number, PlayerDto>
  cards: Record<number, CardDto>
  name: (id: number | null | undefined) => string
}

function who(v: View, ref: EntityRef | null): { owner: number | null; label: string } {
  if (!ref) return { owner: null, label: 'someone' }
  if (ref.kind === 'player') return { owner: ref.id, label: v.name(ref.id) }
  const c = v.cards[ref.id]
  return { owner: c?.controllerId ?? null, label: shortName(c) }
}

/** Each player's lines, by player id: drawn as a popup over the timeline beside that player's seat. */
export function useCallouts(): Map<number, Line[]> {
  const game = useForge((s) => s.game)
  const players = useForge((s) => s.players)
  const cards = useForge((s) => s.cards)
  const stack = useForge((s) => s.stack)
  const combat = useForge((s) => s.combat)
  const prompt = useForge((s) => s.prompt?.message ?? '')
  const okLabel = useForge((s) => s.buttons?.ok.label ?? '')
  const highlighted = useForge((s) => s.highlighted)
  const mine = useForge((s) => !!(s.buttons?.ok.enabled || s.buttons?.cancel.enabled || s.selectable.cardIds.size || s.selectable.playerIds?.size))
  const out = new Map<number, Line[]>()
  if (!game) return out
  const meIds = game.localPlayerIds
  const v: View = { meIds, players, cards, name: (id) => (id == null ? 'someone' : meIds.includes(id) ? 'you' : players[id]?.name ?? 'someone') }
  const add = (id: number | null | undefined, line: Line) => {
    if (id == null || !players[id]) return
    const lines = out.get(id) ?? []
    if (!lines.some((l) => l.key === line.key)) lines.push(line)
    out.set(id, lines)
  }
  const Name = ({ id }: { id: number | null | undefined }) => <B>{v.name(id)}</B>
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  // The turn and step live in the priority box: yours when you are answering, otherwise whoever the game is waiting on.
  const active = game.activePlayerId
  const step = stepWords(game.phase)
  const phaseLine: Line = { key: 'phase', tone: 'plain', text: `Turn ${game.turn}${step ? ` · ${step}` : ''}` }
  const phaseOn = game.priorityPlayerId ?? active
  if (phaseOn != null) add(phaseOn, phaseLine)
  for (const id of meIds) if (mine && id !== phaseOn) add(id, phaseLine)

  // Yours first: what the engine is asking you, while it is yours to answer.
  for (const id of meIds) if (mine && prompt) add(id, { key: 'prompt', tone: 'you', text: prompt })
  if (mine && /discard/i.test(`${prompt} ${okLabel}`)) {
    const names = [...highlighted]
      .filter((k) => k.startsWith('card:'))
      .map((k) => shortName(cards[Number(k.slice(5))]))
      .filter((n) => n && n !== 'a card')
    for (const id of meIds) {
      add(id, { key: 'discarding', tone: 'ember', text: names.length ? <>Discarding <B>{names.join(', ')}</B></> : 'Choose what to discard' })
    }
  }

  // Combat: who is attacking whom, with what, and who is blocking.
  const bands = combat?.bands ?? []
  if (active != null && bands.length) {
    const byDefender = new Map<string, { label: string; owner: number | null; attackers: number[] }>()
    for (const b of bands) {
      const d = who(v, b.defender)
      const k = b.defender ? `${b.defender.kind}:${b.defender.id}` : 'none'
      const e = byDefender.get(k) ?? { label: d.label, owner: d.owner, attackers: [] }
      e.attackers.push(...b.attackerIds)
      byDefender.set(k, e)
    }
    for (const [k, d] of byDefender) {
      const n = d.attackers.length
      const power = d.attackers.reduce((sum, id) => sum + (cards[id]?.power ?? 0), 0)
      add(active, { key: `atk:${k}`, tone: 'ember', text: <>Attacking <B>{d.label}</B> with {plural(n, 'creature')} · {power} power</> })
      if (d.owner != null && d.owner !== active) {
        const what = d.label === v.name(d.owner) ? '' : ` (${d.label})`
        add(d.owner, { key: `def:${k}`, tone: 'ember', text: <>{cap(meIds.includes(d.owner) ? 'you are' : `${players[d.owner]?.name} is`)} attacked{what} by <Name id={active} />: {plural(n, 'creature')}, {power} power</> })
      }
    }
    const blocks = new Map<number, Set<number>>()
    for (const b of bands) {
      for (const id of [...b.blockerIds, ...b.plannedBlockerIds]) {
        const ctl = cards[id]?.controllerId
        if (ctl == null) continue
        const set = blocks.get(ctl) ?? new Set<number>()
        b.attackerIds.forEach((a) => set.add(a))
        blocks.set(ctl, set)
      }
    }
    for (const [ctl, attackers] of blocks) {
      const blockerCount = bands.reduce((n, b) => n + [...b.blockerIds, ...b.plannedBlockerIds].filter((id) => cards[id]?.controllerId === ctl).length, 0)
      const first = cards[[...attackers][0]]
      add(ctl, { key: 'blk', tone: 'steel', text: <>Blocking {attackers.size === 1 ? <B>{shortName(first)}</B> : plural(attackers.size, 'attacker')} with {plural(blockerCount, 'creature')}</> })
    }
  } else if (active != null && game.phase === 'COMBAT_DECLARE_ATTACKERS') {
    add(active, { key: 'declaring', tone: 'ember', text: mine && meIds.includes(active) ? 'Choose a creature, then the player it attacks' : 'Declaring attackers' })
  }

  // The stack, top first: who put each item there and what it is aimed at.
  stack.slice(0, 3).forEach((item, i) => {
    const src = item.sourceCardId != null ? cards[item.sourceCardId] : undefined
    const what = src ? shortName(src) : item.text.split('\n')[0].slice(0, 40)
    const verb = item.isTrigger ? 'Triggered' : item.isAbility ? 'Activated' : 'Cast'
    const targets = item.targets.map((t) => who(v, t))
    add(item.activatorId, {
      key: `stack:${item.id}`,
      tone: 'frost',
      text: <>{verb} <B>{what}</B>{targets.length ? <> targeting <B>{targets.map((t) => t.label).join(', ')}</B></> : null}{i === 0 ? '' : ' (waiting)'}</>,
    })
    for (const t of targets) {
      if (t.owner == null || t.owner === item.activatorId) continue
      const yours = meIds.includes(t.owner)
      const subject = t.label === v.name(t.owner) ? (yours ? 'You are' : `${players[t.owner]?.name} is`) : `${t.label} is`
      add(t.owner, { key: `tgt:${item.id}:${t.label}`, tone: 'ember', text: <>{subject} targeted by <B>{what}</B> from <Name id={item.activatorId} /></> })
    }
  })

  // Priority: who the game is waiting on.
  const p = game.priorityPlayerId
  if (p != null && !(meIds.includes(p) && mine)) {
    add(p, { key: 'priority', tone: 'plain', text: meIds.includes(p) ? 'You have priority' : stack.length ? `Deciding whether to respond` : 'Has priority' })
  }
  return out
}

function useCountdown() {
  const by = useForge((s) => s.respondBy)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (by == null) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [by])
  return by == null ? null : Math.max(0, Math.ceil((by - now) / 1000))
}

/** "In response": you're answering and want longer. The server adds the time (and says so with a new timer). */
export function MoreTime() {
  return (
    <button type="button" title="20 more seconds before priority passes for you"
      onClick={(e) => {
        e.stopPropagation()
        send({ t: 'moreTime' })
      }}
      className="lk-title"
      style={{ pointerEvents: 'auto', border: '1px solid var(--lk-gold-soft)', borderRadius: 3, background: 'rgb(245 213 138 / .1)', color: 'var(--lk-gold)', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '1px 6px', lineHeight: '16px' }}>
      In response +20s
    </button>
  )
}

/** The card shown at the bottom of the timeline: hovered card, stack top, prompt card, selected card, or lead attacker. */
function useTimelineCard(): { card: CardDto; text?: string } | null {
  const hoveredId = usePopover((s) => s.grownCardId ?? (s.peek?.entity.kind === 'card' ? s.peek.entity.id : null))
  const hoverStackId = useBoardUi((s) => s.hoverStackId)
  const key = useForge((s) => {
    if (hoveredId != null && s.cards[hoveredId]) return `${hoveredId}|`
    if (hoverStackId != null) {
      const st = s.stack.find((x) => x.id === hoverStackId)
      if (st?.sourceCardId != null && s.cards[st.sourceCardId]) return `${st.sourceCardId}|${st.text ?? ''}`
    }
    const top = s.stack[0]
    if (top?.sourceCardId != null && s.cards[top.sourceCardId]) {
      return `${top.sourceCardId}|${top.text ?? ''}`
    }
    if (s.prompt?.cardId != null && s.cards[s.prompt.cardId]) {
      return `${s.prompt.cardId}|`
    }
    for (const k of s.highlighted) {
      if (k.startsWith('card:')) {
        const cid = Number(k.slice(5))
        if (s.cards[cid]) return `${cid}|`
      }
    }
    for (const b of s.combat?.bands ?? []) {
      const a = b.attackerIds[0]
      if (a != null && s.cards[a]) return `${a}|`
    }
    return ''
  })
  const cid = key ? Number(key.slice(0, key.indexOf('|'))) : -1
  const text = key ? key.slice(key.indexOf('|') + 1) : ''
  const card = useForge((s) => (cid >= 0 ? s.cards[cid] : undefined))
  return card ? { card, text: text || undefined } : null
}

function FocusCard() {
  const focus = useTimelineCard()
  const peek = usePeek({ kind: 'card', id: focus?.card.id ?? -1 })
  if (!focus) return null
  const { card, text } = focus
  const raw = text && text.startsWith(`${card.name} - `) ? text.slice(card.name.length + 3) : text
  const ability = raw?.replace(/\s*\(Targeting:[^)]*\)\s*$/, '').trim()
  const showAbility = !!ability && ability !== card.text?.trim()
  return (
    <div {...peek} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'auto', cursor: 'help' }}>
      <CardImage card={card} width={176} />
      {showAbility && (
        <div style={{ width: '100%', padding: '5px 8px', borderRadius: 4, background: 'rgb(10 8 6 / .72)', boxShadow: 'inset 0 0 0 1px var(--lk-metal-faint)', fontSize: 12, lineHeight: 1.35, color: 'var(--lk-parchment-dim)', whiteSpace: 'pre-line' }}>
          <RulesText text={ability} size={12} />
        </div>
      )}
    </div>
  )
}

/** Bottom of the timeline column: the priority/response box and the full card, never overlapping the log or cut off at the bottom. */
export function TimelineFooter() {
  const lines = useCallouts()
  const players = useForge((s) => s.players)
  const meIds = useForge(useShallow((s) => s.game?.localPlayerIds ?? []))
  const prioId = useForge((s) => s.game?.priorityPlayerId ?? s.game?.activePlayerId ?? null)
  const left = useCountdown()
  const entries = [...lines.entries()].sort(([a], [b]) => {
    const aMe = meIds.includes(a) ? 0 : a === prioId ? 1 : 2
    const bMe = meIds.includes(b) ? 0 : b === prioId ? 1 : 2
    return aMe - bMe
  })
  return (
    <div className="lk-text" style={{ flex: 'none', marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid var(--lk-metal-line)' }}>
      {entries.map(([id, ls]) => {
        if (!ls.length) return null
        const yours = meIds.includes(id) && ls.some((l) => l.tone === 'you')
        const who = meIds.includes(id) ? 'You' : players[id]?.name ?? 'Player'
        const accent = TONE[ls.find((l) => l.key !== 'phase')?.tone ?? ls[0].tone]
        return (
          <div key={id}
            style={{
              position: 'relative', padding: '7px 10px 8px 12px', borderRadius: 5, color: 'var(--lk-parchment-dim)', fontSize: 12.5, lineHeight: 1.35,
              background: yours ? 'linear-gradient(rgb(245 213 138 / .14), rgb(245 213 138 / .05)), rgb(18 14 10 / .96)' : 'rgb(18 14 10 / .92)',
              boxShadow: `0 0 0 1px ${yours ? 'var(--lk-gold-soft)' : 'var(--lk-metal-line)'}`,
            }}>
            <span aria-hidden style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: accent }} />
            <div className="lk-label" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: yours ? 'var(--lk-gold)' : 'var(--lk-parchment-dim)', marginBottom: 2 }}>
              <span>{yours ? 'Your move' : who}</span>
              {yours && left != null && <span style={{ marginLeft: 'auto', color: left <= 3 ? 'var(--lk-ember-light)' : 'var(--lk-parchment-dim)', fontVariantNumeric: 'tabular-nums' }}>{left}s</span>}
              {yours && left != null && <MoreTime />}
            </div>
            {ls.map((l, i) => l.key === 'phase' ? (
              <div key={l.key} className="lk-title" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--lk-gold)', lineHeight: 1.25, marginBottom: i < ls.length - 1 ? 2 : 0 }}>
                {l.text}
              </div>
            ) : (
              <div key={l.key} style={l.tone === 'you'
                ? { fontFamily: 'var(--lk-font-title)', fontWeight: 700, fontSize: 14.5, lineHeight: 1.22, color: 'var(--lk-parchment)', marginBottom: i < ls.length - 1 ? 3 : 0 }
                : { display: 'flex', gap: 6 }}>
                {l.tone !== 'you' && <span aria-hidden style={{ color: TONE[l.tone], flex: 'none' }}>•</span>}
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        )
      })}
      <FocusCard />
    </div>
  )
}
