// Keyword tiers (docs/DESIGN.md, "Keywords at glance level"). Adding a keyword is adding a row.
// 1 danger, 2 protected, 3 evasion, 4 status.
export type KeywordTier = 1 | 2 | 3 | 4

export type KeywordInfo = { tier: KeywordTier; label: string; rule: string }

export const KEYWORDS: Record<string, KeywordInfo> = {
  deathtouch: { tier: 1, label: 'Deathtouch', rule: 'Any damage it deals to a creature is enough to destroy it.' },
  'first strike': { tier: 1, label: 'First strike', rule: 'Deals combat damage before creatures without first strike.' },
  'double strike': { tier: 1, label: 'Double strike', rule: 'Deals both first-strike and regular combat damage.' },
  trample: { tier: 1, label: 'Trample', rule: 'Damage beyond what its blockers need goes through to the player.' },
  menace: { tier: 1, label: 'Menace', rule: "Can't be blocked except by two or more creatures." },
  infect: { tier: 1, label: 'Infect', rule: 'Deals damage to creatures as −1/−1 counters and to players as poison.' },
  lifelink: { tier: 1, label: 'Lifelink', rule: 'Damage it deals also gains its controller that much life.' },
  hexproof: { tier: 2, label: 'Hexproof', rule: "Can't be the target of opponents' spells or abilities." },
  shroud: { tier: 2, label: 'Shroud', rule: "Can't be the target of spells or abilities." },
  indestructible: { tier: 2, label: 'Indestructible', rule: "Isn't destroyed by damage or \"destroy\" effects." },
  ward: { tier: 2, label: 'Ward', rule: "Spells and abilities opponents target it with are countered unless they pay the ward cost." },
  protection: { tier: 2, label: 'Protection', rule: "Can't be blocked, targeted, dealt damage or enchanted by what it's protected from." },
  flying: { tier: 3, label: 'Flying', rule: 'Can only be blocked by creatures with flying or reach.' },
  reach: { tier: 3, label: 'Reach', rule: 'Can block creatures with flying.' },
  "can't be blocked": { tier: 3, label: "Can't be blocked", rule: "Can't be blocked." },
  haste: { tier: 4, label: 'Haste', rule: 'Can attack and tap the turn it comes under your control.' },
  vigilance: { tier: 4, label: 'Vigilance', rule: "Attacking doesn't cause it to tap." },
  defender: { tier: 4, label: 'Defender', rule: "Can't attack." },
}

export function keywordsByTier(keywords: string[]) {
  return keywords
    .map((k) => ({ key: k, info: KEYWORDS[k] ?? { tier: 4 as KeywordTier, label: k, rule: '' } }))
    .sort((a, b) => a.info.tier - b.info.tier)
}
