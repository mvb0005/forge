import type { ReactNode } from 'react'
import type { PhaseName } from '../protocol'
import type { ForgeState } from '../store'
import type { TableMode } from './contract'

// Peek (hover) content comes from providers (docs/PLAN.md, "Feature registries"). The popover
// system owns timing (intent delay), placement (far side of the table) and keyboard focus;
// providers only say what to show. Providers must not compute rules: they show what the server sent.

export type PeekEntity =
  | { kind: 'card'; id: number }
  | { kind: 'player'; id: number }
  | { kind: 'zone'; playerId: number; zone: 'library' | 'hand' | 'graveyard' | 'exile' | 'command' }
  | { kind: 'keyword'; keyword: string; cardId: number }
  | { kind: 'trigger'; cardId: number; index: number }
  | { kind: 'lane'; attackerId: number }
  | { kind: 'stack'; id: number }

export type PeekContext = {
  phase: PhaseName | null
  mode: TableMode
  state: ForgeState
}

export type PeekSection = {
  key: string
  title?: string
  tone?: 'info' | 'good' | 'danger' | 'trigger'
  body: ReactNode
}

export type PeekProvider = {
  id: string
  order?: number // lower first; default 100
  matches: (e: PeekEntity, ctx: PeekContext) => boolean
  sections: (e: PeekEntity, ctx: PeekContext) => PeekSection[]
}

const providers: PeekProvider[] = []

export function registerPeekProvider(p: PeekProvider) {
  const i = providers.findIndex((x) => x.id === p.id)
  if (i >= 0) providers[i] = p
  else providers.push(p)
  providers.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

export function peekSections(e: PeekEntity, ctx: PeekContext): PeekSection[] {
  return providers.filter((p) => p.matches(e, ctx)).flatMap((p) => p.sections(e, ctx))
}
