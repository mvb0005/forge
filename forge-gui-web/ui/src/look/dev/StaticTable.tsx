import type { CSSProperties, ReactNode } from 'react'
import type { CardDto, PlayerDto } from '../../protocol'
import { CardFrame, type Highlight } from '../CardFrame'
import { Icon, MARK_GLYPH } from '../glyphs'
import { LifeShield } from '../LifeShield'
import { foldLands, ManaRibbon } from '../ManaRibbon'
import { isCombat } from '../phase'
import { SeatStrip, type SeatStatus } from '../SeatStrip'
import { TableHalf, TableMat } from '../TableHalf'
import type { Mat, Metal } from '../theme'
import { boardIdentity } from '../tones'
import { TypeLine } from '../TypeLine'
import { artFor, type Scene } from './scenes'

// Dev only: a static 1440×900 table composed from the look components, so the look can be judged against
// the mockups without a server. Positions are hand-set; the real table uses the card layer (ui/src/table).

export const W = 1440
export const H = 900
const RATIO = 88 / 63

type Item = { card: CardDto; count: number }

function group(cards: CardDto[]): Item[] {
  const out: Item[] = []
  const by = new Map<string, Item>()
  for (const c of cards) {
    if (!c.token) { out.push({ card: c, count: 1 }); continue }
    const k = [c.name, c.power, c.toughness, c.tapped, c.sick, JSON.stringify(c.counters), c.keywords.join()].join('|')
    const g = by.get(k)
    if (g) g.count++
    else { const it = { card: c, count: 1 }; by.set(k, it); out.push(it) }
  }
  return out
}

function row(n: number, x0: number, x1: number, wMax: number, gap = 16) {
  const w = Math.max(44, Math.min(wMax, (x1 - x0 - gap * (n - 1)) / Math.max(1, n)))
  const g = n > 1 ? Math.min(gap, (x1 - x0 - n * w) / (n - 1)) : 0
  return { w, step: w + g }
}

const abs = (x: number, y: number, z = 1): CSSProperties => ({ position: 'absolute', left: x, top: y, zIndex: z })

function Name({ p, sub, size = 22 }: { p: PlayerDto; sub?: ReactNode; size?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="lk-title" style={{ fontWeight: 700, fontSize: size, lineHeight: 1 }}>{p.isAI ? p.name : 'You'}</div>
      {sub && <div style={{ fontSize: 15, color: 'var(--lk-parchment-dim)' }}>{sub}</div>}
    </div>
  )
}

function Pile({ x, y, n, label, back }: { x: number; y: number; n: number; label: string; back?: boolean }) {
  return (
    <div style={{ ...abs(x, y), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }} title={`${label}: ${n}`}>
      <div className="lk-title" style={{
        width: 70, height: 98, borderRadius: 6, boxSizing: 'border-box', display: 'grid', placeItems: 'end center', paddingBottom: 4, fontWeight: 700,
        background: back ? 'repeating-linear-gradient(45deg,#3b2a1a 0 5px,#2e2014 5px 10px)' : 'rgb(10 8 6 / .5)',
        boxShadow: back ? '0 0 0 1.5px var(--lk-ink), 0 0 0 3px var(--lk-metal-dark)' : 'inset 0 0 0 1.5px var(--lk-metal-line)',
      }}>{n}</div>
      <span className="lk-label" style={{ fontSize: 10, color: 'var(--lk-parchment-dim)' }}>{label}</span>
    </div>
  )
}

function Plate({ x, y, w, label, sub, ember }: { x: number; y: number; w: number; label: string; sub?: string; ember?: boolean }) {
  return (
    <div style={{ ...abs(x, y, 4), width: w, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button type="button" className="lk-title" style={{
        fontWeight: 700, fontSize: 18, color: 'var(--lk-on-parchment)', border: 0, borderRadius: 10, minHeight: 50, cursor: 'pointer',
        background: ember ? 'linear-gradient(var(--lk-ember-text), var(--lk-ember-deep))' : 'linear-gradient(var(--lk-metal-bright), var(--lk-metal-deep))',
        boxShadow: '0 0 0 2px var(--lk-ink), 0 0 0 3.5px var(--lk-metal), 0 10px 20px rgb(0 0 0 / .6)',
      }}>{label}</button>
      {sub && <span style={{ fontSize: 15, color: 'var(--lk-parchment-dim)', textAlign: 'center' }}>{sub}</span>}
    </div>
  )
}

export function StaticTable({ scene, mat = 'identity', metal = 'gold' }: { scene: Scene; mat?: Mat; metal?: Metal }) {
  const s = scene.state
  const game = s.game!
  const players = s.players!
  const cards = s.cards!
  const meId = game.localPlayerIds[0]
  const me = players[meId]
  const opps = Object.values(players).filter((p) => p.id !== meId)
  const multi = opps.length > 1
  const focus = opps.find((p) => p.id === game.activePlayerId) ?? opps[0]
  const bf = (p: PlayerDto) => p.zones.battlefield.map((id) => cards[id]).filter(Boolean)
  const colorsOf = (p: PlayerDto) => scene.colors[p.id] ?? boardIdentity(bf(p)).join('')
  const combat = isCombat(game.phase) && !!s.combat?.bands.length
  const bands = s.combat?.bands ?? []
  const attackers = new Set(bands.flatMap((b) => b.attackerIds))
  const blockersOf = new Map(bands.map((b) => [b.attackerIds[0], [...b.blockerIds, ...b.plannedBlockerIds]]))
  const blocking = new Set([...blockersOf.values()].flat())
  const bA = s.blockersAssist?.attackers ?? []
  const focusA = bA.find((a) => a.attackerId === scene.focusAttacker)
  const canBlock = new Set(focusA ? focusA.canBlock : bA.flatMap((a) => a.canBlock))
  const cannot = new Map((focusA?.cannotBlock ?? []).map((c) => [c.id, c.reason]))
  const dies = new Set([...(s.combatAssist?.attackers ?? []), ...(s.combatAssist?.blockers ?? [])].filter((x) => x.dies).map((x) => x.id))
  const lifeAfter = new Map((s.combatAssist?.players ?? []).map((p) => [p.id, p.lifeAfter]))
  const youActive = game.activePlayerId === meId
  const active = players[game.activePlayerId ?? meId]

  const hl = (c: CardDto): Highlight | null => {
    if (attackers.has(c.id)) return 'attacking'
    if (blocking.has(c.id)) return 'blocking'
    if (s.playable?.has(c.id)) return 'playable'
    if (combat && c.controllerId === meId && canBlock.has(c.id) && s.selectable?.cardIds.has(c.id)) return 'choose'
    return null
  }
  const verdict = (c: CardDto) => (dies.has(c.id) ? 'dies' : attackers.has(c.id) && blockersOf.get(c.id)?.length ? 'survives' : null)

  const placed: ReactNode[] = []
  const put = (it: Item, x: number, y: number, w: number, z = 2, extra: { dim?: string | null } = {}) =>
    placed.push(
      <div key={it.card.id} style={abs(x, y, z)}>
        <CardFrame card={it.card} width={w} art={artFor(it.card.name) ?? it.card.img} highlight={hl(it.card)} verdict={verdict(it.card)} count={it.count} base={scene.base[it.card.id]} dim={extra.dim} rotate={!combat && it.card.tapped && !attackers.has(it.card.id)} />
      </div>,
    )
  const permanents = (p: PlayerDto, skip: Set<number>) =>
    group(bf(p).filter((c) => !c.types.includes('Land') && c.attachedToId == null && !skip.has(c.id)).sort((a, b) => +b.types.includes('Creature') - +a.types.includes('Creature')))
  const layRow = (items: Item[], x0: number, x1: number, y: number, wMax: number, extra?: (c: CardDto) => { dim?: string | null }) => {
    const turned = (c: CardDto) => c.tapped && !combat
    const extraW = items.filter((it) => turned(it.card)).length * 0.4
    const { w, step } = row(items.length + extraW, x0, x1, wMax)
    let x = x0
    items.forEach((it) => {
      const t = turned(it.card)
      put(it, x + (t ? (w * RATIO - w) / 2 : 0), y, w, 2, extra?.(it.card))
      x += step + (t ? w * (RATIO - 1) : 0)
    })
  }

  const half = H / 2
  const topY = multi ? 150 : 0
  const halves = (
    <>
      <TableHalf colors={colorsOf(focus)} active={!youActive && focus.id === game.activePlayerId} side="top" style={{ position: 'absolute', left: 0, top: 0, width: W, height: half }} />
      <TableHalf colors={colorsOf(me)} active={youActive} side="bottom" style={{ position: 'absolute', left: 0, top: half, width: W, height: half }} />
    </>
  )

  const oppRibbon = foldLands(bf(focus))
  const myRibbon = foldLands(bf(me))
  const rocks = bf(me).filter((c) => c.name === 'Sol Ring')
  const myHand = me.zones.hand.map((id) => cards[id])
  const priority = game.priorityPlayerId === meId

  let body: ReactNode
  if (!combat) {
    const opItems = permanents(focus, new Set())
    layRow(opItems, 300, multi ? 1404 : 1180, topY + (multi ? 40 : 150), multi ? 112 : 132)
    layRow(permanents(me, new Set()), 300, 1180, 486, 132)
    const n = myHand.length
    myHand.forEach((c, i) => {
      const t = n > 1 ? i / (n - 1) - 0.5 : 0
      const play = s.playable?.has(c.id)
      placed.push(
        <div key={c.id} style={{ ...abs(720 - 70 + t * Math.min(560, n * 92), 776 + Math.abs(t) * 44, 5 + i), transform: `rotate(${t * 22}deg)`, transformOrigin: '50% 100%' }}>
          <CardFrame card={c} width={140} art={artFor(c.name) ?? c.img} highlight={play ? 'playable' : null} />
        </div>,
      )
    })
    body = (
      <>
        {!multi && (
          <>
            <div style={{ ...abs(34, 30, 3), display: 'flex', gap: 14, alignItems: 'center' }}>
              <LifeShield life={focus.life} poison={focus.poison} width={78} rim={!youActive ? 'active' : 'metal'} />
              <Name p={focus} sub={`${focus.handCount} in hand · ${focus.libraryCount} library`} />
            </div>
            <div style={abs(520, 36, 3)}><ManaRibbon sources={oppRibbon} summary={`${oppRibbon.reduce((a, r) => a + r.untapped, 0)} untapped`} /></div>
          </>
        )}
        <div style={{ ...abs(34, 414, 6), width: W - 68 }}>
          <TypeLine activeName={active.name} you={youActive} phase={game.phase} turn={game.turn} hint={scene.hint ?? s.prompt?.message} gemLabels={!multi} order={multi ? orderFrom(players, game.activePlayerId, meId) : undefined} activeId={game.activePlayerId ?? undefined} />
        </div>
        <div style={{ ...abs(34, 690, 3), display: 'flex', gap: 14, alignItems: 'center' }}>
          <LifeShield life={me.life} poison={me.poison} width={92} rim={youActive ? 'bright' : 'metal'} commander={scene.cmdDamage?.[meId]} />
          <Name p={me} />
        </div>
        <div style={abs(300, 694, 3)}><ManaRibbon sources={[...myRibbon, ...rocks.map((r) => ({ sym: '2', untapped: r.tapped ? 0 : 1, total: 1, label: r.name }))]} usable={priority && youActive} /></div>
        <Pile x={1262} y={690} n={me.libraryCount} label="Library" back />
        <Pile x={1346} y={690} n={me.zones.graveyard.length} label="Graveyard" />
        <Plate x={1196} y={486} w={210} label={youActive ? 'To combat' : 'OK'} sub={youActive ? 'End turn' : undefined} />
      </>
    )
  } else {
    // Combat: the type line rises, the band opens, lanes hold attacker over block slot.
    const lanes = group(bands.filter((b) => !blockersOf.get(b.attackerIds[0])?.length).map((b) => cards[b.attackerIds[0]])).concat(
      bands.filter((b) => blockersOf.get(b.attackerIds[0])?.length).map((b) => ({ card: cards[b.attackerIds[0]], count: 1 })),
    )
    const order = new Map(bands.map((b, i) => [b.attackerIds[0], i]))
    lanes.sort((a, b) => order.get(a.card.id)! - order.get(b.card.id)!)
    const laneX1 = multi ? 1040 : 1030
    const { w, step } = row(lanes.length, 300, laneX1, 128, 68)
    const ch = w * RATIO
    lanes.forEach((it, i) => {
      const x = 300 + i * step
      const blk = (blockersOf.get(it.card.id) ?? []).map((id) => cards[id])
      const isFocus = it.card.id === scene.focusAttacker
      if (isFocus) placed.push(<div key={'f' + i} style={{ ...abs(x - 22, 254, 1), width: w + 44, height: 400, borderRadius: 14, boxShadow: '0 0 0 2px var(--lk-gold), 0 0 34px rgb(245 213 138 / .22)', background: 'rgb(245 213 138 / .05)' }} />)
      put(it, x, 266, w, 3)
      if (blk.length) blk.forEach((b, j) => put({ card: b, count: 1 }, x + j * 36, 474 + j * 26, w, 4 + j))
      else {
        const hint = scene.slotHints?.[it.card.id]
        placed.push(
          <div key={'s' + it.card.id} className="lk-title" style={{
            ...abs(x, 474, 2), width: w, height: Math.min(ch, 168), boxSizing: 'border-box', borderRadius: 9, border: `2px dashed ${isFocus ? 'var(--lk-gold)' : 'rgb(143 180 227 / .65)'}`,
            background: 'rgb(10 8 6 / .45)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center',
            color: isFocus ? '#f7e3b0' : 'var(--lk-steel-text)', fontWeight: 700, fontSize: Math.max(10, w * 0.1), padding: 6,
          }}>
            <Icon g={MARK_GLYPH.block} size={24} color="currentColor" />
            {hint?.rule ?? 'Block'}
            {hint?.through && <span className="lk-text" style={{ fontSize: Math.max(11, w * 0.117), color: 'var(--lk-ember-light)' }}>{hint.through}</span>}
          </div>,
        )
      }
    })
    const oppRest = permanents(focus, attackers)
    if (!multi) layRow(oppRest, 980, 1404, 40, 96)
    const mine = permanents(me, blocking)
    layRow(mine, 322, 1040, 700, 128, (c) => ({ dim: cannot.get(c.id) ?? (canBlock.size && c.types.includes('Creature') && !canBlock.has(c.id) ? "Can't block" : null) }))
    const net = me.life - (lifeAfter.get(meId) ?? me.life)
    body = (
      <>
        <div style={{ ...abs(0, 214, 0), width: W, height: 446, background: 'linear-gradient(rgb(255 106 61 / 0), rgb(255 106 61 / .1) 50%, rgb(255 106 61 / 0))' }} />
        {!multi && (
          <div style={{ ...abs(34, 30, 3), display: 'flex', gap: 14, alignItems: 'center' }}>
            <LifeShield life={focus.life} width={78} rim="active" />
            <Name p={focus} sub={<span style={{ color: 'var(--lk-ember-light)' }}>{oppRibbon.reduce((a, r) => a + r.untapped, 0)} open · {focus.handCount} cards in hand</span>} />
          </div>
        )}
        <div style={{ ...abs(34, multi ? 162 : 196, 6), width: W - 68 }}>
          <TypeLine activeName={active.name} you={youActive} phase={game.phase} turn={game.turn} hint={scene.hint ?? s.prompt?.message} ledger={net ? `Net −${net}` : undefined} order={multi ? orderFrom(players, game.activePlayerId, meId) : undefined} activeId={game.activePlayerId ?? undefined} />
        </div>
        <div style={{ ...abs(34, 712, 3), display: 'flex', gap: 14, alignItems: 'center' }}>
          <LifeShield life={me.life} preview={lifeAfter.get(meId) ?? null} poison={me.poison} width={92} rim="ember" commander={scene.cmdDamage?.[meId]} />
          <Name p={me} />
        </div>
        <Ledger x={1080} y={262} scene={scene} cards={cards} me={me} after={lifeAfter.get(meId)} />
      </>
    )
  }

  const strips = multi
    ? opps.map((p, i) => (
        <div key={p.id} style={abs(26 + i * 474, 26, 7)}>
          <SeatStrip
            player={p} colors={colorsOf(p)} open={foldLands(bf(p))} threat={scene.threats?.[p.id]} triggers={scene.triggers?.[p.id]}
            status={statusOf(p, game.activePlayerId, bands, combat)} preview={lifeAfter.get(p.id) ?? null}
            commander={p.zones.command.length ? { name: cards[p.zones.command[0]].name.split(',')[0], tax: 0 } : undefined}
          />
        </div>
      ))
    : null

  return (
    <TableMat mat={mat} metal={metal} halves={halves} style={{ width: W, height: H, flex: 'none' }}>
      {body}
      {placed}
      {strips}
    </TableMat>
  )
}

function statusOf(p: PlayerDto, activeId: number | null, bands: { defender: { kind: string; id: number } | null }[], combat: boolean): SeatStatus {
  if (p.id === activeId) return combat ? 'attacking' : 'active'
  if (combat && bands.some((b) => b.defender?.kind === 'player' && b.defender.id === p.id)) return 'defending'
  return 'waiting'
}

function orderFrom(players: Record<number, PlayerDto>, activeId: number | null, meId: number) {
  const ids = Object.keys(players).map(Number).sort((a, b) => a - b)
  const i = Math.max(0, ids.indexOf(activeId ?? ids[0]))
  return [...ids.slice(i), ...ids.slice(0, i)].map((id) => ({ id, name: players[id].name, you: id === meId, out: players[id].hasLost }))
}

function Ledger({ x, y, scene, cards, me, after }: { x: number; y: number; scene: Scene; cards: Record<number, CardDto>; me: PlayerDto; after?: number }) {
  const a = scene.state.combatAssist
  if (!a) return null
  const bands = scene.state.combat?.bands ?? []
  const rows = bands.map((b) => {
    const atk = cards[b.attackerIds[0]]
    const blk = [...b.blockerIds, ...b.plannedBlockerIds].map((id) => cards[id])
    const dmg = a.attackers.find((x) => x.id === atk.id)?.damage ?? 0
    const died = blk.filter((c) => a.blockers.find((x) => x.id === c.id)?.dies).map((c) => c.name)
    return { key: atk.id, text: blk.length ? `${atk.name} blocked${died.length ? `: ${died.join(', ')} dies` : ''}` : `${atk.name} unblocked`, dmg: blk.length ? 0 : dmg }
  })
  return (
    <div style={{
      ...abs(x, y, 6), width: 326, boxSizing: 'border-box', padding: '18px 20px', borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 12,
      background: 'linear-gradient(#211a13, var(--lk-ink-2))', boxShadow: '0 0 0 2px var(--lk-ink), 0 0 0 3.5px var(--lk-metal), 0 16px 34px rgb(0 0 0 / .65)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--lk-metal-line)', paddingBottom: 8 }}>
        <span className="lk-title" style={{ fontWeight: 700, fontSize: 20 }}>Combat</span>
        <span className="lk-label" style={{ fontSize: 11, color: 'var(--lk-parchment-dim)' }}>as blocks stand</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, lineHeight: 1.25 }}>
          <Icon g={MARK_GLYPH.dies} size={16} color="var(--lk-ember-text)" />
          <span style={{ flex: 1 }}>{r.text}</span>
          {r.dmg > 0 && <b style={{ color: 'var(--lk-ember-light)' }}>−{r.dmg}</b>}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--lk-metal-line)', paddingTop: 10 }}>
        <span style={{ fontSize: 17 }}>You</span>
        <span className="lk-title" style={{ fontWeight: 900, fontSize: 26 }}>{me.life} → <span style={{ color: 'var(--lk-ember-light)' }}>{after ?? me.life}</span></span>
      </div>
      <button type="button" className="lk-title" style={{ fontWeight: 700, fontSize: 17, color: 'var(--lk-on-parchment)', background: 'linear-gradient(var(--lk-metal-bright), var(--lk-metal-deep))', border: 0, borderRadius: 10, minHeight: 48, cursor: 'pointer' }}>
        Confirm blocks
      </button>
    </div>
  )
}
