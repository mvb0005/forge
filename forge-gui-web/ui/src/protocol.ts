// Mirrors forge-gui-web/PROTOCOL.md. Change the spec first, then this file.

export type EntityRef = { kind: 'card' | 'player'; id: number }

export type PhaseName =
  | 'UNTAP' | 'UPKEEP' | 'DRAW' | 'MAIN1' | 'COMBAT_BEGIN' | 'COMBAT_DECLARE_ATTACKERS'
  | 'COMBAT_DECLARE_BLOCKERS' | 'COMBAT_FIRST_STRIKE_DAMAGE' | 'COMBAT_DAMAGE' | 'COMBAT_END'
  | 'MAIN2' | 'END_OF_TURN' | 'CLEANUP'

export type LogEntry = { type: string; message: string }

// The client's game: the wire GameWire plus the log, which the store keeps from state.logAppend.
export type GameDto = GameWire & { log: LogEntry[] }

export type GameWire = {
  turn: number
  phase: PhaseName | null
  activePlayerId: number | null
  priorityPlayerId: number | null
  localPlayerIds: number[]
  gameOver: boolean
  winner: string | null
  turnOrder?: number[]
}

export type ManaPool = { W: number; U: number; B: number; R: number; G: number; C: number }

export type PlayerDto = {
  id: number
  name: string
  isAI: boolean
  life: number
  poison: number
  counters: Record<string, number>
  mana: ManaPool
  handCount: number
  libraryCount: number
  zones: { hand: number[]; battlefield: number[]; graveyard: number[]; exile: number[]; command: number[] }
  avatarImg: string | null
  discordId?: string // the Discord user at this seat (a Discord Activity game); avatarImg is then their picture
  hasLost: boolean
  colorIdentity?: string[]
  commanders?: { cardId: number; casts: number; tax: number }[]
  commanderDamage?: { cardId: number; damage: number }[]
}

export type ZoneName = 'hand' | 'library' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack' | 'other'

export type CardDto = {
  id: number
  zone: ZoneName
  ownerId: number
  controllerId: number
  hidden: boolean
  name: string
  img: string | null
  backImg: string | null
  manaCost: string
  colors: string
  typeLine: string
  types: string[]
  text: string
  power: number | null
  toughness: number | null
  basePower?: number
  baseToughness?: number
  loyalty: number | null
  defense: number | null
  damage: number
  counters: Record<string, number>
  keywords: string[]
  keywordLabels?: Record<string, string[]>
  tapped: boolean
  sick: boolean
  phasedOut: boolean
  faceDown: boolean
  token: boolean
  attachedToId: number | null
  attachedToPlayerId: number | null
  attachmentIds: number[]
  exiledWithId: number | null
  heldExileIds: number[]
  commander: boolean
  sprocket: number | null
}

export type StackItemDto = {
  id: number
  sourceCardId: number | null
  activatorId: number | null
  text: string
  isAbility: boolean
  isTrigger: boolean
  targets: EntityRef[]
}

export type CombatBand = {
  attackerIds: number[]
  defender: EntityRef | null
  blockerIds: number[]
  plannedBlockerIds: number[]
}
export type CombatDto = { bands: CombatBand[] }

export type CombatAssist = {
  attackers: { id: number; dies: boolean; damage: number }[]
  blockers: { id: number; dies: boolean }[]
  players: { id: number; lifeAfter: number; poisonAfter: number; lethal: boolean }[]
}

export type BlockersAssist = {
  attackers: {
    attackerId: number
    canBlock: number[]
    cannotBlock: { id: number; reason: string }[]
    minBlockers: number
  }[]
}

export type ManaAssist = {
  players: { id: number; total: number; open: Record<string, number> }[]
}

export type AssistMessage =
  | { t: 'assist'; kind: 'combat'; combat: CombatAssist | null }
  | { t: 'assist'; kind: 'blockers'; blockers: BlockersAssist | null }
  | { t: 'assist'; kind: 'mana'; mana: ManaAssist | null }

export type ChoiceItem = { i: number; label: string; ref: EntityRef | null }

export type Ask = { t: 'ask'; id: number } & (
  | { kind: 'confirm'; title: string; message: string; cardId: number | null; options: string[]; defaultIndex: number }
  | { kind: 'option'; title: string; message: string; options: string[]; defaultIndex: number }
  | { kind: 'input'; title: string; message: string; initial: string; options: string[] | null; numeric: boolean }
  | { kind: 'choose'; title: string; message: string; min: number; max: number; items: ChoiceItem[]; selected: number[] }
  | { kind: 'order'; title: string; message: string; min: number; max: number; items: ChoiceItem[]; cardId: number | null }
  | { kind: 'ability'; cardId: number; items: (ChoiceItem & { enabled: boolean })[] }
  | { kind: 'damage'; attackerId: number; blockerIds: number[]; damage: number; defender: EntityRef | null; overrideOrder: boolean; maySkip: boolean }
  | { kind: 'amount'; sourceCardId: number | null; amount: number; atLeastOne: boolean; label: string; items: ChoiceItem[] }
  | { kind: 'arrange'; title: string; cardIds: number[]; manipulableIds: number[]; toTop: boolean; toBottom: boolean; toAnywhere: boolean }
)

export type ServerMessage =
  | { t: 'hello'; version: number; caps?: string[]; inMatch: boolean; seat?: number; who?: string; returnUrl?: string }
  // The match this seat belonged to is over (connected after it ended).
  | { t: 'ended'; summary?: string }
  | {
      t: 'state'; seq: number; full: boolean; game?: GameWire; players?: PlayerDto[]; cards?: CardDto[]
      removedCards?: number[]; stack?: StackItemDto[]; combat?: CombatDto | null
      logAppend?: LogEntry[]; logReset?: true
    }
  | { t: 'prompt'; playerId: number; message: string; cardId: number | null }
  | { t: 'buttons'; playerId: number; ok: { label: string; enabled: boolean }; cancel: { label: string; enabled: boolean }; focusOk: boolean }
  | { t: 'selectables'; cardIds: number[]; playerIds?: number[]; min: number; max: number }
  | { t: 'highlight'; entities: EntityRef[]; on: boolean }
  | { t: 'playable'; cardIds: number[] }
  | { t: 'notice'; level: 'info' | 'error' | 'flash'; title: string; message: string }
  | { t: 'reveal'; title: string; cardIds: number[] }
  | Ask
  | { t: 'gameOver'; winner: string | null; summary: string }
  // The server passes priority for you in `seconds` unless you act (null: no timer). Cap timer.respond.
  | { t: 'timer'; seconds: number | null }
  | AssistMessage
  | { t: 'error'; message: string }

export type ManaColor = keyof ManaPool

export type ClientMessage =
  | { t: 'selectCard'; cardId: number; others?: number[]; shift: boolean; button: number }
  | { t: 'selectPlayer'; playerId: number; shift: boolean; button: number }
  | { t: 'ok' }
  | { t: 'moreTime' } // "In response": 20 more seconds on the respond timer
  | { t: 'cancel' }
  | { t: 'answer'; id: number; value: unknown }
  | { t: 'useMana'; color: ManaColor }
  | { t: 'undo' }
  | { t: 'concede' }
  | { t: 'alphaStrike' }
  | { t: 'reorderHand'; cardId: number; index: number }
