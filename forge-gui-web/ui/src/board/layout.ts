import type { CardDto, CombatDto, PlayerDto, GameDto } from '../protocol'

// Pure board layout: grouping identical permanents into lanes, lining up combat, and fitting tiles.

export type Group = {
  key: string
  ids: number[] // ascending; ids[0] is the stable position key
  top: CardDto
  role: 'attacker' | 'blocker' | null
  attackerIds: number[] // for blockers: the attackers they block
}

export type LandPile = { key: string; name: string; ids: number[]; tapped: number; groups: Group[] }

export type Lanes = {
  creatures: Group[]
  walkers: Group[] // planeswalkers and battles, front lane right end
  lands: LandPile[]
  others: Group[]
}

export type CombatRole = { role: 'attacker' | 'blocker'; key: string; attackerIds: number[] }

const rolesCache = new WeakMap<CombatDto, Map<number, CombatRole>>()
const NO_ROLES = new Map<number, CombatRole>()

export function combatRoles(combat: CombatDto | null): Map<number, CombatRole> {
  if (!combat) return NO_ROLES
  const cached = rolesCache.get(combat)
  if (cached) return cached
  const roles = new Map<number, CombatRole>()
  rolesCache.set(combat, roles)
  for (const band of combat.bands) {
    const blockers = [...new Set([...band.blockerIds, ...band.plannedBlockerIds])]
    const def = band.defender ? `${band.defender.kind}:${band.defender.id}` : '-'
    // Unblocked attackers group by defender; blocked ones stay with their own band so blockers can line up.
    const attKey = blockers.length ? `band:${Math.min(...band.attackerIds)}` : `def:${def}`
    for (const id of band.attackerIds) roles.set(id, { role: 'attacker', key: attKey, attackerIds: [] })
    for (const id of blockers) {
      const prev = roles.get(id)
      const attackerIds = [...new Set([...(prev?.attackerIds ?? []), ...band.attackerIds])].sort((a, b) => a - b)
      roles.set(id, { role: 'blocker', key: `blk:${attackerIds.join(',')}`, attackerIds })
    }
  }
  return roles
}

const sortedEntries = (r: Record<string, number>) =>
  Object.keys(r)
    .filter((k) => r[k])
    .sort()
    .map((k) => `${k}=${r[k]}`)
    .join(',')

// Card objects are replaced, never mutated, when the server upserts them, so the per-card part of
// the key can be cached by identity.
const baseKeys = new WeakMap<CardDto, string>()

function baseKey(c: CardDto) {
  let k = baseKeys.get(c)
  if (k === undefined) {
    k = [
      c.name,
      c.faceDown ? 'fd' : '',
      c.img ?? '',
      c.power,
      c.toughness,
      c.loyalty,
      c.defense,
      sortedEntries(c.counters),
      c.damage,
      c.tapped ? 'T' : '',
      c.sick ? 'S' : '',
      c.phasedOut ? 'P' : '',
      c.token ? 'tok' : '',
      [...c.keywords].sort().join('+'),
    ].join('|')
    baseKeys.set(c, k)
  }
  return k
}

/** Everything that must match for two permanents to share a tile. null = never groups. */
export function groupKey(c: CardDto, role: CombatRole | undefined, highlighted = false): string | null {
  if (c.attachmentIds.length || c.heldExileIds.length) return null
  return `${baseKey(c)}|${role ? role.key : ''}|${highlighted ? 'hl' : ''}`
}

export function buildGroups(cards: CardDto[], roles: Map<number, CombatRole>, highlighted?: Set<string>): Group[] {
  const byKey = new Map<string, Group>()
  const out: Group[] = []
  for (const c of [...cards].sort((a, b) => a.id - b.id)) {
    const role = roles.get(c.id)
    const k = groupKey(c, role, highlighted?.has(`card:${c.id}`))
    const existing = k !== null ? byKey.get(k) : undefined
    if (existing) {
      existing.ids.push(c.id)
      continue
    }
    const g: Group = { key: k === null ? `card:${c.id}` : `g:${c.id}`, ids: [c.id], top: c, role: role?.role ?? null, attackerIds: role?.attackerIds ?? [] }
    if (k !== null) byKey.set(k, g)
    out.push(g)
  }
  return out // ordered by lowest id, because cards were visited in id order
}

const has = (c: CardDto, t: string) => c.types.includes(t)

/**
 * Splits one player's battlefield into lanes. Cards attached to another visible card are left out
 * (they render behind their host). Groups keep the position of their lowest card id.
 */
export function groupBattlefield(
  cards: CardDto[],
  combat: CombatDto | null,
  opts: { highlighted?: Set<string>; isVisible?: (id: number) => boolean } = {},
): Lanes {
  const roles = combatRoles(combat)
  const isVisible = opts.isVisible ?? (() => true)
  const creatures: CardDto[] = []
  const walkers: CardDto[] = []
  const lands: CardDto[] = []
  const others: CardDto[] = []
  for (const c of cards) {
    if (c.attachedToId != null && isVisible(c.attachedToId)) continue
    if (has(c, 'Creature')) creatures.push(c)
    else if (has(c, 'Planeswalker') || has(c, 'Battle')) walkers.push(c)
    else if (has(c, 'Land')) lands.push(c)
    else others.push(c)
  }
  const piles = new Map<string, CardDto[]>()
  for (const c of lands) {
    const name = c.faceDown ? 'Face-down land' : c.name
    piles.set(name, [...(piles.get(name) ?? []), c])
  }
  const landPiles: LandPile[] = [...piles.entries()].map(([name, cs]) => {
    const ids = cs.map((c) => c.id).sort((a, b) => a - b)
    return { key: `land:${ids[0]}`, name, ids, tapped: cs.filter((c) => c.tapped).length, groups: buildGroups(cs, roles, opts.highlighted) }
  })
  landPiles.sort((a, b) => a.ids[0] - b.ids[0])
  return {
    creatures: buildGroups(creatures, roles, opts.highlighted),
    walkers: buildGroups(walkers, roles, opts.highlighted),
    lands: landPiles,
    others: buildGroups(others, roles, opts.highlighted),
  }
}

const menace = (c: Column) => [...c.top, ...c.bottom].some((g) => g.role === 'attacker' && g.top.keywords.includes('menace'))

export type Column = { key: string; slots: number; top: Group[]; bottom: Group[] }

/**
 * Lines up combat between the two displayed front lanes: one column per attacking group, with the
 * groups blocking it on the other side. Non-combat groups keep their usual order after the columns.
 */
export function combatColumns(top: Group[], bottom: Group[]) {
  const attackers = [...top.map((g) => ({ g, side: 'top' as const })), ...bottom.map((g) => ({ g, side: 'bottom' as const }))]
    .filter((x) => x.g.role === 'attacker')
    .sort((a, b) => a.g.ids[0] - b.g.ids[0])
  const columns: Column[] = []
  const colOf = new Map<number, Column>() // attacker id -> column
  for (const { g, side } of attackers) {
    const col: Column = { key: `col:${g.ids[0]}`, slots: 1, top: side === 'top' ? [g] : [], bottom: side === 'bottom' ? [g] : [] }
    for (const id of g.ids) colOf.set(id, col)
    columns.push(col)
  }
  const placed = new Set<Group>()
  for (const [lane, side] of [[top, 'top'], [bottom, 'bottom']] as const) {
    for (const g of lane) {
      if (g.role !== 'blocker') continue
      const col = g.attackerIds.map((id) => colOf.get(id)).find((c) => c && c[side === 'top' ? 'bottom' : 'top'].length)
      if (!col) continue
      col[side].push(g)
      placed.add(g)
    }
  }
  // Menace lanes always keep room for a second blocker (D-11).
  for (const c of columns) c.slots = Math.max(menace(c) ? 2 : 1, c.top.length, c.bottom.length)
  return {
    columns,
    topRest: top.filter((g) => g.role !== 'attacker' && !placed.has(g)),
    bottomRest: bottom.filter((g) => g.role !== 'attacker' && !placed.has(g)),
  }
}

// ---- Fitting tiles into a lane -------------------------------------------------------------

export const CARD_RATIO = 88 / 63

export type LaneItem = { key: string; slots: number; end?: boolean }

export type FitOpts = {
  minW: number
  maxW: number
  slotX: number // slot width as a multiple of tile width (gap + fan)
  slotY: number // row height as a multiple of tile height (attachments, attack shift)
}

function rowsNeeded(items: LaneItem[], cap: number) {
  let rows = 1
  let used = 0
  for (const it of items) {
    const s = Math.min(it.slots, cap)
    if (used + s > cap) {
      rows++
      used = 0
    }
    used += s
  }
  return rows
}

/** Largest tile width (and horizontal step) that fits all items in W×H without scrolling. */
export function fitLane(items: LaneItem[], W: number, H: number, o: FitOpts): { w: number; step: number } {
  if (!items.length || W <= 0 || H <= 0) return { w: o.maxW, step: o.maxW * o.slotX }
  for (let w = Math.floor(o.maxW); w >= o.minW; w--) {
    const step = w * o.slotX
    const cap = Math.floor((W + (step - w)) / step) // last slot needs no gap
    if (cap < 1) continue
    const rows = rowsNeeded(items, cap)
    if (rows * w * CARD_RATIO * o.slotY <= H) return { w, step }
  }
  // Even the smallest tile doesn't fit: overlap within as many rows as fit.
  const w = o.minW
  const rowsMax = Math.max(1, Math.floor(H / (w * CARD_RATIO * o.slotY)))
  const total = items.reduce((n, it) => n + it.slots, 0)
  let cap = Math.max(1, Math.ceil(total / rowsMax))
  while (rowsNeeded(items, cap) > rowsMax) cap++
  return { w, step: cap > 1 ? Math.min(w * o.slotX, (W - w) / (cap - 1)) : w }
}

export type Placed = { x: number; y: number }

/**
 * Positions items in rows from the left; items marked `end` are pushed to the right end of the
 * last row when everything fits on one row. `fromBottom` stacks rows upward from the bottom edge.
 */
export function placeLane(items: LaneItem[], W: number, H: number, w: number, step: number, rowH: number, fromBottom: boolean) {
  const out = new Map<string, Placed>()
  const cap = Math.max(1, Math.floor((W - w) / step + 1e-6) + 1)
  const rows: LaneItem[][] = [[]]
  let used = 0
  for (const it of items) {
    const s = Math.min(it.slots, cap)
    if (used + s > cap && rows[rows.length - 1].length) {
      rows.push([])
      used = 0
    }
    rows[rows.length - 1].push(it)
    used += s
  }
  rows.forEach((row, r) => {
    const y = fromBottom ? H - (r + 1) * rowH : r * rowH
    let x = 0
    const starts = row.filter((it) => !it.end)
    const ends = row.filter((it) => it.end)
    for (const it of starts) {
      out.set(it.key, { x, y })
      x += it.slots * step
    }
    const endSlots = ends.reduce((n, it) => n + it.slots, 0)
    let ex = Math.max(x, W - w - (endSlots - 1) * step)
    if (rows.length > 1) ex = x
    for (const it of ends) {
      out.set(it.key, { x: ex, y })
      ex += it.slots * step
    }
  })
  return out
}

// ---- Multiplayer focus ----------------------------------------------------------------------

/** The opponent shown full size: whoever attacks you, else the active player, else the next opponent. */
export function chooseFocus(
  players: PlayerDto[],
  meId: number,
  game: GameDto | null,
  combat: CombatDto | null,
  cards: Record<number, CardDto>,
): number | null {
  const opps = players.filter((p) => p.id !== meId && !p.hasLost)
  if (!opps.length) return players.find((p) => p.id !== meId)?.id ?? null
  for (const band of combat?.bands ?? []) {
    if (band.defender?.kind !== 'player' || band.defender.id !== meId) continue
    const ctrl = cards[band.attackerIds[0]]?.controllerId
    if (ctrl != null && opps.some((p) => p.id === ctrl)) return ctrl
  }
  const active = game?.activePlayerId
  if (active != null && opps.some((p) => p.id === active)) return active
  const sorted = [...players].sort((a, b) => a.id - b.id)
  const i = sorted.findIndex((p) => p.id === meId)
  for (let k = 1; k <= sorted.length; k++) {
    const p = sorted[(i + k) % sorted.length]
    if (p.id !== meId && !p.hasLost) return p.id
  }
  return opps[0].id
}

/** Which card a click on a group acts on, and the rest for shift-click. */
export function pickFromGroup(ids: number[], cards: Record<number, CardDto>, selectable: Set<number>, playable: Set<number>, highlighted: Set<string>) {
  const selecting = selectable.size > 0
  const pool = selecting ? ids.filter((id) => selectable.has(id)) : ids
  const order = (id: number) => {
    const c = cards[id]
    let s = 0
    if (highlighted.has(`card:${id}`)) s += 4
    if (!playable.has(id)) s += 2
    if (c?.tapped) s += 1
    return s
  }
  const sorted = [...(pool.length ? pool : ids)].sort((a, b) => order(a) - order(b) || a - b)
  const cardId = sorted[0]
  return { cardId, others: (pool.length ? pool : ids).filter((id) => id !== cardId) }
}
