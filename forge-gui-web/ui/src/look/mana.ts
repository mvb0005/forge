// Mana cost strings. The server sends ManaCost.getSimpleString(): "{2}{W}{U}", "{X}{R}", "{W/U}", "{2/W}", "{G/P}",
// "{B/G/P}", "{C}", "{S}", "{0}", or "" for no cost. Forge script shorthand ("2 W U", "2 WU") is accepted too.

export type Sym = string // normalised, upper case, no braces: "2", "W", "W/U", "2/W", "G/P", "C", "S", "X", "T", "Q"

const TOKEN = /\d+(?:\/[WUBRG])?|[WUBRGCSXYZTQE](?:\/[WUBRGCP])*/g

/** Mana value. {2}{W} is 3, {W/U} is 1, {2/W} is 2, {X}{R} is 1. No cost is 0. */
export function cmc(cost: string | null | undefined): number {
  let n = 0
  for (const s of parseCost(cost)) {
    const info = symInfo(s)
    if (info.generic && /^\d+$/.test(info.generic)) n += Number(info.generic)
    else if (info.colors.length || info.phyrexian) n += 1
  }
  return n
}

export function parseCost(cost: string | null | undefined): Sym[] {
  if (!cost) return []
  const s = cost.trim().toUpperCase()
  if (!s || s === 'NO COST') return []
  if (s.includes('{')) return [...s.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].trim()).filter(Boolean)
  return s.match(TOKEN) ?? []
}

export type SymInfo = {
  colors: string[] // the colour(s) of the pip background, WUBRG or C; empty for generic
  generic: string | null // "2" in {2}, {2/W}; "X" in {X}
  phyrexian: boolean
  special: 'T' | 'Q' | 'S' | 'E' | null
}

export function symInfo(sym: Sym): SymInfo {
  const parts = sym.split('/')
  const phyrexian = parts.includes('P')
  const rest = parts.filter((p) => p !== 'P')
  const colors = rest.filter((p) => /^[WUBRGC]$/.test(p))
  const generic = rest.find((p) => /^\d+$/.test(p) || /^[XYZ]$/.test(p)) ?? null
  const special = rest.length === 1 && /^[TQSE]$/.test(rest[0]) ? (rest[0] as SymInfo['special']) : null
  return { colors, generic, phyrexian, special }
}
