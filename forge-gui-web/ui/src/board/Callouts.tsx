import { useEffect, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CardDto, EntityRef, PlayerDto } from '../protocol'
import type { Region } from '../table/contract'
import { useForge } from '../store'

// What is happening to whom, beside each player's border (3-4 players): one callout per player with a part in
// it right now. Attacking and attacked (combat bands), blocking, casting and being targeted (the stack), and
// holding priority; yours also carries the engine's prompt and the respond countdown. Everything is read
// from what the engine sent: who is in combat, what is on the stack, whose priority it is.

type Tone = 'you' | 'ember' | 'steel' | 'frost' | 'plain'
type Line = { key: string; tone: Tone; text: ReactNode }

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

/** Each player's lines, by player id. */
function useCallouts(): Map<number, Line[]> {
  const game = useForge((s) => s.game)
  const players = useForge((s) => s.players)
  const cards = useForge((s) => s.cards)
  const stack = useForge((s) => s.stack)
  const combat = useForge((s) => s.combat)
  const prompt = useForge((s) => s.prompt?.message ?? '')
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

  // Yours first: what the engine is asking you, while it is yours to answer.
  for (const id of meIds) if (mine && prompt) add(id, { key: 'prompt', tone: 'you', text: prompt })

  // Combat: who is attacking whom, with what, and who is blocking.
  const active = game.activePlayerId
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
    add(active, { key: 'declaring', tone: 'ember', text: 'Declaring attackers' })
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

export function Callouts({ regions }: { regions: Record<string, Region> }) {
  const lines = useCallouts()
  const meIds = useForge(useShallow((s) => s.game?.localPlayerIds ?? []))
  const left = useCountdown()
  return (
    <>
      {[...lines].map(([id, ls]) => {
        const border = regions[`border:${id}`]
        if (!border || !ls.length) return null
        const yours = meIds.includes(id) && ls.some((l) => l.tone === 'you')
        const accent = TONE[ls[0].tone]
        return (
          <div key={id} className="bf-pop lk-text"
            style={{
              position: 'absolute', left: border.x + border.w + 6, top: border.y + 8, zIndex: 21, maxWidth: 320, minWidth: 180, pointerEvents: 'none',
              padding: '7px 11px 8px 12px', borderRadius: 5, color: 'var(--lk-parchment-dim)', fontSize: 13, lineHeight: 1.35,
              background: yours ? 'linear-gradient(rgb(245 213 138 / .14), rgb(245 213 138 / .05)), rgb(18 14 10 / .94)' : 'rgb(18 14 10 / .92)',
              boxShadow: `0 0 0 1px ${yours ? 'var(--lk-gold-soft)' : 'var(--lk-metal-line)'}, 0 4px 16px rgb(0 0 0 / .5)${yours ? ', 0 0 22px rgb(245 213 138 / .14)' : ''}`,
            }}>
            {/* the pointer, toward the border it belongs to */}
            <span aria-hidden style={{ position: 'absolute', left: -6, top: 12, width: 10, height: 10, transform: 'rotate(45deg)', background: 'rgb(18 14 10 / .94)', boxShadow: `-1px 1px 0 ${yours ? 'var(--lk-gold-soft)' : 'var(--lk-metal-line)'}` }} />
            <span aria-hidden style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: accent }} />
            {yours && (
              <div className="lk-label" style={{ display: 'flex', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--lk-gold)', marginBottom: 2 }}>
                <span>Your move</span>
                {left != null && <span style={{ marginLeft: 'auto', color: left <= 3 ? 'var(--lk-ember-light)' : 'var(--lk-parchment-dim)', fontVariantNumeric: 'tabular-nums' }}>Passing in {left}s</span>}
              </div>
            )}
            {ls.map((l, i) => (
              <div key={l.key} style={l.tone === 'you'
                ? { fontFamily: 'var(--lk-font-title)', fontWeight: 700, fontSize: 17, lineHeight: 1.22, color: 'var(--lk-parchment)', marginBottom: i < ls.length - 1 ? 4 : 0 }
                : { display: 'flex', gap: 6 }}>
                {l.tone !== 'you' && <span aria-hidden style={{ color: TONE[l.tone], flex: 'none' }}>•</span>}
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}
