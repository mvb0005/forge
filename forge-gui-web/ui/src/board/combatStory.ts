import type { CardDto, CombatAssist, CombatDto, PhaseName, PlayerDto } from '../protocol'

// What combat is doing, in words, step by step: who attacks whom, what the engine predicts (the combat assist),
// and afterwards what happened. Display only: every number is the engine's (assist, life, zones). The "before"
// side of the recap is the life each player had when combat began (the store's combatMemo).

export type CombatMemo = { turn: number; attackerId: number | null; life: Record<number, number>; ids: number[]; names: Record<number, string> }

export type Step = { label: string; state: 'done' | 'now' | 'next' }
export type Story = { steps: Step[]; lines: string[]; over: boolean }

type In = {
  phase: PhaseName | null
  turn: number
  activeId: number | null
  localIds: number[]
  players: Record<number, PlayerDto>
  cards: Record<number, CardDto>
  combat: CombatDto | null
  assist: CombatAssist | null
  memo: CombatMemo | null
}

const STEPS = ['Attack', 'Block', 'Damage']
const AT: Partial<Record<PhaseName, number>> = {
  COMBAT_BEGIN: -1, COMBAT_DECLARE_ATTACKERS: 0, COMBAT_DECLARE_BLOCKERS: 1,
  COMBAT_FIRST_STRIKE_DAMAGE: 2, COMBAT_DAMAGE: 2, COMBAT_END: 3,
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

function list(names: string[]) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function combatStory(x: In): Story | null {
  const step = x.phase != null && x.phase in AT ? AT[x.phase]! : null
  // Out of combat: the last combat's recap, until the next combat begins (the store keeps it that long).
  const after = step == null && !!x.memo?.ids.length
  if (step == null && !after) return null
  const you = (id: number) => x.localIds.includes(id)
  const who = (id: number | null) => (id == null ? 'Someone' : you(id) ? 'You' : x.players[id]?.name ?? 'Someone')
  const whom = (id: number) => (you(id) ? 'you' : x.players[id]?.name ?? 'someone')
  const now = after ? 3 : step!
  const steps = STEPS.map((label, i): Step => ({ label, state: i < now ? 'done' : i === now ? 'now' : 'next' }))
  const bands = (x.combat?.bands ?? []).filter((b) => b.attackerIds.length)
  const attacker = who(x.activeId)
  const lines: string[] = []

  if (now >= 2) {
    // Damage dealt: the life each player had when combat began against now, and the combatants gone from play.
    const memo = x.memo
    // In this turn's damage steps, the memo is this combat's; one from an earlier turn means nothing attacked now.
    if (!memo?.ids.length || (!after && memo.turn !== x.turn)) return { steps, lines: ['No attacks'], over: after }
    for (const [id, before] of Object.entries(memo.life)) {
      const life = x.players[Number(id)]?.life
      if (life != null && life !== before) lines.push(`${who(Number(id))}: ${before} → ${life}`)
    }
    if (!lines.length) lines.push('No one lost life')
    const gone = memo.ids.filter((id) => x.cards[id]?.zone !== 'battlefield').map((id) => memo.names[id] ?? x.cards[id]?.name).filter((n): n is string => !!n)
    lines.push(gone.length ? `Died: ${list(gone)}` : 'No creatures died')
    const title = !after ? 'Damage dealt' : memo.turn === x.turn ? 'Last combat' : `Last combat · ${memo.attackerId != null && you(memo.attackerId) ? 'your' : `${who(memo.attackerId)}’s`} turn`
    return { steps, lines: [title, ...lines], over: after }
  }

  if (now < 0) return { steps, lines: [`${attacker === 'You' ? 'You are' : `${attacker} is`} going to combat`], over: false }

  if (!bands.length) {
    lines.push(now === 0 ? (attacker === 'You' ? 'Choose attackers' : `${attacker} is choosing attackers`) : 'No attacks')
    return { steps, lines, over: false }
  }

  // Grouped by what is attacked: a player, or a planeswalker or battle (its controller's name stands for it).
  const groups = new Map<string, { name: string; n: number; blocked: number }>()
  for (const b of bands) {
    const d = b.defender
    const key = d ? `${d.kind}:${d.id}` : '?'
    const name = !d ? 'someone' : d.kind === 'player' ? whom(d.id) : x.cards[d.id]?.name ?? 'a permanent'
    const g = groups.get(key) ?? { name, n: 0, blocked: 0 }
    g.n += b.attackerIds.length
    if (b.blockerIds.length || b.plannedBlockerIds.length) g.blocked += b.attackerIds.length
    groups.set(key, g)
  }
  for (const g of groups.values()) {
    lines.push(`${attacker} ${attacker === 'You' ? 'attack' : 'attacks'} ${g.name} with ${plural(g.n, 'creature')}`)
    if (now === 1) lines.push(`${g.name[0].toUpperCase()}${g.name.slice(1)} ${g.name === 'you' ? 'block' : 'blocks'} ${g.blocked} of ${g.n}`)
  }
  for (const p of x.assist?.players ?? []) {
    const life = x.players[p.id]?.life
    if (life == null) continue
    const tail = p.lethal ? ' · lethal' : now === 0 ? ' if unblocked' : ''
    lines.push(`${who(p.id)}: ${life} → ${p.lifeAfter}${tail}`)
  }
  if (now === 1 && x.assist) {
    const dies = [...x.assist.attackers, ...x.assist.blockers].filter((c) => c.dies).map((c) => x.cards[c.id]?.name).filter((n): n is string => !!n)
    if (dies.length) lines.push(`Would die: ${list(dies)}`)
  }
  return { steps, lines, over: false }
}
