import type { PeekContext, PeekEntity, PeekProvider, PeekSection } from '../../table/peek'

// Shows the engine's combat assists as sent: `combat` (dies / damage through / life after) for an
// attacker or its lane and for blockers, `blockers` (who may block, and why others can't).

const name = (ctx: PeekContext, id: number) => ctx.state.cards[id]?.name ?? `#${id}`

function attackerOf(e: PeekEntity) {
  return e.kind === 'lane' ? e.attackerId : e.kind === 'card' ? e.id : null
}

function attackerSections(id: number, ctx: PeekContext): PeekSection[] {
  const { combatAssist, blockersAssist, combat, players } = ctx.state
  const out: PeekSection[] = []
  const a = combatAssist?.attackers.find((x) => x.id === id)
  if (a) {
    const band = combat?.bands.find((b) => b.attackerIds.includes(id))
    const def = band?.defender?.kind === 'player' ? band.defender.id : null
    const p = def != null ? combatAssist?.players.find((x) => x.id === def) : undefined
    out.push({
      key: 'combat-attacker',
      title: 'If combat resolves now',
      tone: a.dies ? 'danger' : 'good',
      body: (
        <ul className="space-y-0.5 text-xs">
          <li>{a.dies ? 'Dies' : 'Survives'}</li>
          {a.damage > 0 && <li>{a.damage} damage through</li>}
          {p && def != null && (
            <li>
              {players[def]?.name ?? 'Defender'}: {players[def]?.life ?? '?'} → {p.lifeAfter}
              {p.poisonAfter > 0 && ` · ${p.poisonAfter} poison`}
              {p.lethal && <span className="font-semibold text-danger"> · lethal</span>}
            </li>
          )}
        </ul>
      ),
    })
  }
  const b = blockersAssist?.attackers.find((x) => x.attackerId === id)
  if (b) {
    out.push({
      key: 'combat-blockable',
      title: b.minBlockers > 1 ? `Needs ${b.minBlockers} blockers` : 'Can block it',
      tone: 'info',
      body: (
        <div className="text-xs">
          {b.canBlock.length ? b.canBlock.map((x) => name(ctx, x)).join(', ') : <span className="text-ink-dim">None of your creatures</span>}
        </div>
      ),
    })
  }
  return out
}

function blockerSections(id: number, ctx: PeekContext): PeekSection[] {
  const { combatAssist, blockersAssist } = ctx.state
  const out: PeekSection[] = []
  const bl = combatAssist?.blockers.find((x) => x.id === id)
  if (bl) out.push({ key: 'combat-blocker', title: 'As it blocks', tone: bl.dies ? 'danger' : 'good', body: <div className="text-xs">{bl.dies ? 'Dies' : 'Survives'}</div> })
  const why = (blockersAssist?.attackers ?? []).flatMap((a) => a.cannotBlock.filter((x) => x.id === id).map((x) => ({ attackerId: a.attackerId, reason: x.reason })))
  if (why.length)
    out.push({
      key: 'combat-cannot-block',
      title: "Can't block",
      tone: 'danger',
      body: (
        <ul className="space-y-0.5 text-xs">
          {why.map((w) => (
            <li key={w.attackerId}>
              <span className="font-semibold">{name(ctx, w.attackerId)}</span>
              <span className="text-ink-dim">: {w.reason}</span>
            </li>
          ))}
        </ul>
      ),
    })
  return out
}

export const combatPeek: PeekProvider = {
  id: 'combat',
  order: 20,
  matches: (e, ctx) => ctx.mode === 'combat' && (e.kind === 'lane' || e.kind === 'card' || e.kind === 'player'),
  sections: (e, ctx) => {
    if (e.kind === 'player') {
      const p = ctx.state.combatAssist?.players.find((x) => x.id === e.id)
      if (!p) return []
      return [
        {
          key: 'combat-player',
          title: 'After combat',
          tone: p.lethal ? 'danger' : 'info',
          body: (
            <div className="text-xs">
              Life {ctx.state.players[e.id]?.life ?? '?'} → {p.lifeAfter}
              {p.poisonAfter > 0 && ` · ${p.poisonAfter} poison`}
              {p.lethal && <span className="font-semibold text-danger"> · lethal</span>}
            </div>
          ),
        },
      ]
    }
    const id = attackerOf(e)
    if (id == null) return []
    return e.kind === 'lane' ? attackerSections(id, ctx) : [...attackerSections(id, ctx), ...blockerSections(id, ctx)]
  },
}
