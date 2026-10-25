import type { PhaseName } from '../protocol'

// Presentation of the turn structure: which of the five gems a step belongs to, and its type-line words.
export const GEMS = ['Beginning', 'Main', 'Combat', 'Main', 'End'] as const

const STEP: Record<PhaseName, [gem: number, words: string]> = {
  UNTAP: [0, 'Beginning · Untap'],
  UPKEEP: [0, 'Beginning · Upkeep'],
  DRAW: [0, 'Beginning · Draw'],
  MAIN1: [1, 'Main Phase'],
  COMBAT_BEGIN: [2, 'Combat · Beginning of Combat'],
  COMBAT_DECLARE_ATTACKERS: [2, 'Combat · Declare Attackers'],
  COMBAT_DECLARE_BLOCKERS: [2, 'Combat · Declare Blockers'],
  COMBAT_FIRST_STRIKE_DAMAGE: [2, 'Combat · First-Strike Damage'],
  COMBAT_DAMAGE: [2, 'Combat · Combat Damage'],
  COMBAT_END: [2, 'Combat · End of Combat'],
  MAIN2: [3, 'Second Main Phase'],
  END_OF_TURN: [4, 'Ending · End Step'],
  CLEANUP: [4, 'Ending · Cleanup'],
}

export const gemOf = (p: PhaseName | null) => (p ? STEP[p][0] : -1)
export const stepWords = (p: PhaseName | null) => (p ? STEP[p][1] : '')
export const isCombat = (p: PhaseName | null) => gemOf(p) === 2
export const turnOf = (name: string, you: boolean) => (you ? 'Your Turn' : `${name}’s Turn`)
