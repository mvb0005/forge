import type { PeekProvider, PeekSection } from '../../table/peek'
import { keywordsByTier } from '../keywords'

const tierTone = { 1: 'text-danger', 2: 'text-accent', 3: 'text-ink', 4: 'text-ink-dim' } as const

export const cardPeek: PeekProvider = {
  id: 'card',
  order: 10,
  matches: (e, ctx) => e.kind === 'card' && !!ctx.state.cards[e.id],
  sections: (e, ctx) => {
    if (e.kind !== 'card') return []
    const c = ctx.state.cards[e.id]
    if (c.hidden) return [{ key: 'card', body: <div className="text-ink-dim">{c.faceDown ? 'Face-down card' : 'Hidden card'}</div> }]
    const pt = c.power != null && c.toughness != null ? `${c.power}/${c.toughness}` : c.loyalty != null ? `Loyalty ${c.loyalty}` : c.defense != null ? `Defense ${c.defense}` : null
    const kws = keywordsByTier(c.keywords)
    const out: PeekSection[] = [
      {
        key: 'card',
        body: (
          <div className="space-y-1">
            {c.img && ctx.depth === 'inspect' && <img src={c.img} alt="" className="mb-2 w-full rounded-lg" />}
            <div className="flex items-baseline gap-2">
              <span className="flex-1 font-semibold">{c.name}</span>
              {c.manaCost && <span className="font-mono text-xs text-ink-dim">{c.manaCost}</span>}
            </div>
            <div className="flex items-baseline gap-2 text-xs text-ink-dim">
              <span className="flex-1">{c.typeLine}</span>
              {pt && <span className="font-semibold text-ink">{pt}</span>}
            </div>
          </div>
        ),
      },
    ]
    if (kws.length)
      out.push({
        key: 'keywords',
        body: (
          <ul className="space-y-0.5 text-xs">
            {kws.map(({ key, info }) => (
              <li key={key}>
                <span className={`font-semibold ${tierTone[info.tier]}`}>{info.label}</span>
                {info.rule && <span className="text-ink-dim"> · {info.rule}</span>}
              </li>
            ))}
          </ul>
        ),
      })
    if (c.text) out.push({ key: 'text', body: <p className="whitespace-pre-line text-xs leading-relaxed">{c.text}</p> })
    if (ctx.depth === 'inspect') {
      const facts = [
        c.tapped && 'Tapped',
        c.sick && 'Summoning sick',
        c.damage > 0 && `${c.damage} damage marked`,
        c.token && 'Token',
        c.commander && 'Commander',
        ...Object.entries(c.counters).filter(([, n]) => n > 0).map(([k, n]) => `${n} × ${k} counter`),
        c.controllerId !== c.ownerId && `Owned by ${ctx.state.players[c.ownerId]?.name ?? c.ownerId}`,
      ].filter(Boolean)
      if (facts.length) out.push({ key: 'facts', title: 'Now', body: <div className="text-xs text-ink-dim">{facts.join(' · ')}</div> })
    }
    return out
  },
}
