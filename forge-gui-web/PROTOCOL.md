# Forge Web protocol (v2)

The browser UI talks to the Java server over a single WebSocket at `ws://127.0.0.1:7777/ws`.
Every frame is a UTF-8 JSON text frame holding one object with a string field `t` (the type).
Unknown `t` values must be logged and ignored by both sides, never crash.

The server projects Forge's view objects (GameView / PlayerView / CardView / StackItemView /
CombatView) into the plain DTOs below. The browser never sees TrackableProperty names; if the
UI needs something new, add a field to a DTO here first.

Ids: card ids and player ids come from Forge and are only unique within their kind, so a
reference to "a card or a player" is always an `EntityRef`:

```ts
type EntityRef = { kind: "card" | "player"; id: number };
```

## HTTP

| Path | Meaning |
|---|---|
| `GET /` and static files | the built UI (`forge-gui-web/ui/dist`) when present |
| `GET /img/card/{imageKey}` | card image for a Forge image key (URL-encoded). 200 with the file from the read-only pics dir, otherwise 302 to a Scryfall image URL, otherwise 404. `Cache-Control: max-age=86400`. |

The UI only uses `CardDto.img` and never builds image URLs itself.

## Server to client

### `hello`
`{ t:"hello", version:2, caps:string[], inMatch:boolean }`, sent on every connect. If `inMatch`, a full
`state` follows, then the current prompt/buttons/selectables/ask and every current `assist`.

`caps` lists optional features this server has, so client and server can evolve separately.
A client ignores caps it doesn't know and must not rely on a feature whose cap is missing.

| Cap | Meaning |
|---|---|
| `log.append` | the game log arrives as `state.logAppend` / `logReset` (v1 sent `game.log`) |
| `selectables.players` | `selectables.playerIds` is sent |
| `assist.combat` | `assist` kind `combat` |
| `assist.blockers` | `assist` kind `blockers` |
| `assist.mana` | `assist` kind `mana` |
| `card.basePT` | `CardDto.basePower` / `baseToughness` |
| `card.keywordLabels` | `CardDto.keywordLabels`, and the keyword keys `shroud`, `protection`, `can't be blocked` |
| `player.colorIdentity` | `PlayerDto.colorIdentity` |
| `player.commander` | `PlayerDto.commanders` / `commanderDamage` |
| `game.turnOrder` | `GameDto.turnOrder` |

Changes from v1: `caps`; `GameDto.log` replaced by `state.logAppend`/`logReset`;
`selectables.playerIds`; assists are computed when the engine asks the human for input (not on
every state change); assist kind `blockers`. Anything added after that is an optional field behind
one of the caps above. A client that doesn't know the cap ignores the field.

**Board facts.** Some fields need the game model, which the state flush never reads: base P/T,
`can't be blocked`, `colorIdentity` and `turnOrder`. The server reads them at each decision point
(when it computes assists) and the next state carries them, so between decision points (most of an
AI turn) they can lag the board. They are absent until the first decision point of a match.

### `lobby`
`{ t:"lobby", decks:{ id:string, name:string, colors:string }[], states:string[] }`, sent after
`hello` when not in a match. `decks` lists what the server can start a match with (`"random:WU"` style
ids for generated two-colour decks are always present). `states` lists the saved board files
(bench/states, bench/token-pod-turn12.txt, and the web UI's fixtures in forge-gui-web/tools/states).

### `state`
```ts
{
  t: "state",
  seq: number,              // increases by 1 per state message
  full: boolean,            // true: replace everything; false: merge
  game?: GameDto,           // present when changed (always when full)
  players?: PlayerDto[],    // upserts, whole objects
  cards?: CardDto[],        // upserts, whole objects
  removedCards?: number[],  // card ids no longer visible anywhere
  stack?: StackItemDto[],   // whole stack, top first, when changed
  combat?: CombatDto | null,// whole combat when changed; null = no combat
  logAppend?: LogEntry[],   // game log entries, oldest first: new since the last state, or the whole log with logReset
  logReset?: true           // replace the log with logAppend instead of appending (always set on full states)
}

type LogEntry = { type: string; message: string };
```
The log is append-only: a non-full state carries only the entries added since the previous state
(absent when none). A full state carries the last 200 entries with `logReset:true`. Clients keep
at most the last 200.
State is coalesced (at most ~30 messages/s) and is always flushed before any `prompt`,
`buttons`, `selectables`, `highlight` or `ask` message, so ids in those are always known.

```ts
type PhaseName = "UNTAP"|"UPKEEP"|"DRAW"|"MAIN1"|"COMBAT_BEGIN"|"COMBAT_DECLARE_ATTACKERS"
  |"COMBAT_DECLARE_BLOCKERS"|"COMBAT_FIRST_STRIKE_DAMAGE"|"COMBAT_DAMAGE"|"COMBAT_END"
  |"MAIN2"|"END_OF_TURN"|"CLEANUP";

type GameDto = {
  turn: number;
  phase: PhaseName | null;
  activePlayerId: number | null;     // whose turn
  priorityPlayerId: number | null;
  localPlayerIds: number[];          // seats this browser controls (normally one)
  gameOver: boolean;
  winner: string | null;             // display name, when gameOver
  turnOrder?: number[];              // players still in the game, in turn order (direction included); board fact
};

type PlayerDto = {
  id: number;
  name: string;
  isAI: boolean;
  life: number;
  poison: number;
  counters: Record<string, number>;  // energy, experience, rad, ... (poison excluded)
  mana: { W: number; U: number; B: number; R: number; G: number; C: number }; // floating pool
  handCount: number;
  libraryCount: number;
  zones: {                            // card ids, in Forge's order
    hand: number[];                   // ids also for opponents; their CardDto is hidden
    battlefield: number[];
    graveyard: number[];
    exile: number[];
    command: number[];
  };
  avatarImg: string | null;
  hasLost: boolean;
  colorIdentity?: string[];          // e.g. ["W","U"], WUBRG order, [] = colourless; board fact, fixed for the match
  commanders?: { cardId: number; casts: number; tax: number }[]; // this player's commanders (Commander games only)
  commanderDamage?: { cardId: number; damage: number }[];        // combat damage this player took from each commander, > 0 only
};

type ZoneName = "hand"|"library"|"battlefield"|"graveyard"|"exile"|"command"|"stack"|"other";

type CardDto = {
  id: number;
  zone: ZoneName;
  ownerId: number;
  controllerId: number;
  hidden: boolean;            // true: only id/zone/owner/controller/tapped/attachment fields are real
  name: string;
  img: string | null;         // "/img/card/<key>" for the face currently shown
  backImg: string | null;     // other face, for DFC/MDFC/flip hover
  manaCost: string;           // Forge shard string, e.g. "{2}{G}{G}", "" for none
  colors: string;             // subset of "WUBRG" in that order, "" = colourless
  typeLine: string;           // "Creature — Elf Druid"
  types: string[];            // core types: "Creature","Land","Artifact","Enchantment","Planeswalker","Battle","Instant","Sorcery","Kindred"
  text: string;               // current rules text
  power: number | null;       // null when not a creature
  toughness: number | null;
  basePower?: number;         // creatures on the battlefield, only when base and current P/T differ (both sent)
  baseToughness?: number;
  loyalty: number | null;
  defense: number | null;
  damage: number;
  counters: Record<string, number>;
  keywords: string[];         // only the badge-worthy ones, lowercase: flying, reach, deathtouch, trample,
                              // lifelink, first strike, double strike, vigilance, menace, haste,
                              // hexproof, indestructible, infect, ward, defender, shroud, protection,
                              // "can't be blocked" (creatures on the battlefield; board fact)
  keywordLabels?: Record<string, string[]>; // key in keywords -> the engine's full titles, when they say more
                              // than the key: { ward: ["Ward {2}"], protection: ["Protection from red"],
                              // hexproof: ["Hexproof from black"] }. One entry per instance; absent when none
  tapped: boolean;
  sick: boolean;              // summoning sick and not hasty
  phasedOut: boolean;
  faceDown: boolean;
  token: boolean;
  attachedToId: number | null;     // card this is attached to
  attachedToPlayerId: number | null;
  attachmentIds: number[];
  exiledWithId: number | null;     // card that holds this one in exile
  heldExileIds: number[];          // cards this one holds in exile
  commander: boolean;
  sprocket: number | null;         // contraptions/attractions
};

type StackItemDto = {
  id: number;
  sourceCardId: number | null;
  activatorId: number | null;
  text: string;
  isAbility: boolean;
  isTrigger: boolean;
  targets: EntityRef[];
};

type CombatDto = {
  bands: {
    attackerIds: number[];
    defender: EntityRef | null;    // player, planeswalker or battle being attacked
    blockerIds: number[];
    plannedBlockerIds: number[];
  }[];
};
```

Notes on the optional fields:
- `basePower`/`baseToughness`: the P/T after characteristic-defining and "becomes X/Y" effects
  (layers 7a-7b), before counters, pumps and anthems (Forge's `Card.getCurrentPower`). Current above
  base is raised, below is lowered. Sent only when they differ, to keep one-card messages small; absent
  means "same as current" (or not known yet).
- `commanders[].tax` is the engine's commander tax, 2 x `casts` (casts from the command zone).
  Every player's commanders are always among the state's cards (hidden when not visible, e.g. in a
  library), so the ids in `commanders` and `commanderDamage` are always known.
- `colorIdentity`: the commanders' colour identity in Commander, otherwise the colours of the deck's
  cards, otherwise (saved boards) the colours of the cards the player owns.

### `prompt`
`{ t:"prompt", playerId:number, message:string, cardId:number|null }`: the current
instruction ("Declare attackers", "Choose target creature", ...).

### `buttons`
`{ t:"buttons", playerId:number, ok:{label:string, enabled:boolean}, cancel:{label:string, enabled:boolean}, focusOk:boolean }`

### `selectables`
`{ t:"selectables", cardIds:number[], playerIds:number[], min:number, max:number }`: cards and
players that are valid choices for the current input. Empty `cardIds` and `playerIds` clear it.
`min`/`max` count cards and players together.

`playerIds` (cap `selectables.players`) are the players a click would do something for right now:
the players among the choices of a "choose entities" input, the players a spell or ability may
target (`SpellAbility.canTarget`, players who lost excluded), and the players you may attack while
declaring attackers. It is re-sent when it changes and cleared when that input ends. Not covered:
paying Phyrexian mana with life by clicking yourself, and target filters the targeting input keeps
private (a click on such a player is rejected by the engine with a `flash` notice).

### `highlight`
`{ t:"highlight", entities:EntityRef[], on:boolean }`: chosen targets or other cards
the engine wants emphasised. `on:false` removes those entities from the highlight set.

### `playable`
`{ t:"playable", cardIds:number[] }`: cards with something castable or activatable right now
(Forge's "weakly selectable"). Empty clears.

### `notice`
`{ t:"notice", level:"info"|"error"|"flash", title:string, message:string }`: non-blocking.
`flash` = the player clicked something invalid.

### `reveal`
`{ t:"reveal", title:string, cardIds:number[] }`: non-blocking. Show these cards (revealed
hand, top of library, ...) until dismissed or the next `reveal`.

### `ask`
A blocking question. The game thread waits until the client sends `answer` with the same `id`.
There is at most one open ask. The client must always offer a way to answer.
```ts
type ChoiceItem = { i: number; label: string; ref: EntityRef | null };

type Ask = { t: "ask"; id: number } & (
  | { kind: "confirm"; title: string; message: string; cardId: number | null; options: string[]; defaultIndex: number }  // answer: index
  | { kind: "option";  title: string; message: string; options: string[]; defaultIndex: number }                        // answer: index
  | { kind: "input";   title: string; message: string; initial: string; options: string[] | null; numeric: boolean }   // answer: string | null
  | { kind: "choose";  title: string; message: string; min: number; max: number; items: ChoiceItem[]; selected: number[] } // answer: number[] (item i values)
  | { kind: "order";   title: string; message: string; min: number; max: number; items: ChoiceItem[]; cardId: number | null } // answer: number[] (all chosen items in order)
  | { kind: "ability"; cardId: number; items: (ChoiceItem & { enabled: boolean })[] }                                    // answer: i | null
  | { kind: "damage";  attackerId: number; blockerIds: number[]; damage: number; defender: EntityRef | null; overrideOrder: boolean; maySkip: boolean } // answer: { [key: string]: number } with keys "card:<id>" / "player:<id>" (defender), or null to skip
  | { kind: "amount";  sourceCardId: number | null; amount: number; atLeastOne: boolean; label: string; items: ChoiceItem[] } // answer: { [i: string]: number }
  | { kind: "arrange"; title: string; cardIds: number[]; manipulableIds: number[]; toTop: boolean; toBottom: boolean; toAnywhere: boolean } // answer: number[] (card ids in final order)
);
```
Notes:
- `choose` covers getChoices / one / oneOrNone / many / chooseSingleEntityForEffect /
  chooseEntitiesForEffect. `min:0,max:1` = optional single choice.
- `order` covers order / insertInList. For a plain reorder, `min == max == items.length`.
- Forge's `getInteger` arrives as `choose` with number labels or as `input` with `numeric:true`.
- Sideboarding is not in v1. The server keeps the main deck.
- `choose.selected` holds item `i` values, not card ids.
- `arrange.cardIds[0]` is the top of the pile; the answer uses the same orientation.
- `damage` answer `null` (only when `maySkip`) = let Forge assign damage itself (the server returns null to the engine).
- `ability` has no title; clients title it with the card name.
- On `lobby` or a `full` state the client drops any open ask and reveal; the server re-sends what is still open.

### `gameOver`
`{ t:"gameOver", winner:string|null, summary:string }`. Then `lobby` again once the match ends.

### `assist`
Help computed by the engine; the UI only displays it and never computes rules itself.

`{ t:"assist", kind:K, [K]: payload | null }`: the payload sits in a field named like the kind.
Assists are computed when the engine asks the human for input (a prompt, a click that changes the
current input, an `ask`), not on every state change, and a kind is sent only when its payload
changed. A `state` always precedes it, so its ids are known. `null` clears that kind. On connect
every current assist is re-sent after the full state. Unknown kinds must be ignored.

#### kind `combat`
`{ t:"assist", kind:"combat", combat: CombatAssist | null }`. `null` = no combat.
```ts
type CombatAssist = {
  attackers: { id: number; dies: boolean; damage: number }[]; // damage reaching its defender (unblocked, or trample)
  blockers: { id: number; dies: boolean }[];
  players: { id: number; lifeAfter: number; poisonAfter: number; lethal: boolean }[]; // each attacked player
};
```
Computed with Forge's ComputerUtilCombat on the board as it stands (no activated abilities, no
cards in hand). Before blocks it describes the attack as if unblocked.

#### kind `blockers`
`{ t:"assist", kind:"blockers", blockers: BlockersAssist | null }`, while you are declaring
blockers (null otherwise). One entry per attacker attacking you, your planeswalkers or your
battles, recomputed after every block you assign.
```ts
type BlockersAssist = {
  attackers: {
    attackerId: number;
    canBlock: number[];                         // your creatures that may block it now, plus those already blocking it
    cannotBlock: { id: number; reason: string }[]; // your other untapped creatures, with why not
    minBlockers: number;                        // blockers it needs at least (2 for menace), 1 normally
  }[];
};
```
Legality is the engine's (`CombatUtil.canBlock(attacker, blocker, combat)`, so it reflects the
blocks assigned so far). Tapped creatures that can't block are left out. Reasons, first that
applies: "Phased out", "Can't block",
"Can't block alone", "Already blocking", "Block limit reached", "Can't be blocked",
"Can't be blocked by more creatures", then evasion of the attacker:
"Flying: needs flying or reach", "Shadow: needs shadow" / "Shadow: can only block shadow",
"Horsemanship: needs horsemanship",
"Fear: needs an artifact or black creature", "Intimidate: needs an artifact creature or a shared colour",
"Skulk: power too high", or "Can't block this attacker" when the engine's evasion check failed for
another reason; otherwise "Must block another attacker" (a lure effect). When fewer of your creatures could
block an attacker than its `minBlockers`, the engine would reject any block on it, so the ones not
already blocking it move to `cannotBlock` with "Menace: needs a second blocker" (menace) or
"Needs N blockers".

#### kind `mana`
`{ t:"assist", kind:"mana", mana: ManaAssist | null }`: per player, what their untapped permanents
could add right now with a free tap mana ability. The floating pool is `PlayerDto.mana`, not this.
```ts
type ManaAssist = {
  players: { id: number; total: number; open: Record<string, number> }[];
};
```
Each source counts once, under one key, with the mana it adds: `"W"` to `"G"`, `"C"` for one kind;
several letters in WUBRGC order (`"WG"`, `"URG"`) for a source that adds one of those (a dual land);
`"any"` for any colour. `total` is the sum of the values. Example: `{ W:2, U:1, C:1, any:1, WG:1 }`,
`total: 6`. Only abilities whose cost includes `{T}` and no mana count (lands, rocks, dorks that
aren't summoning sick; filters and signets don't), and the engine's `canPlay` must allow them.
Like every assist it is computed at decision points (again whenever the board or the set of tapped
permanents changed), so during most of an AI turn it shows the board at your last decision.

### `error`
`{ t:"error", message:string }`: protocol or server error, shown to the user.

## Client to server

| Message | Meaning |
|---|---|
| `{t:"startMatch", deck:string, opponentDeck:string, opponents:number}` | deck ids from `lobby` (`"random:XY"` or a listed id). opponents 1..3 |
| `{t:"startState", state:string}` | start from a saved board (a `lobby.states` entry). The human takes seat 1 |
| `{t:"selectCard", cardId:number, others?:number[], shift:boolean, button:number}` | click on a card (button 1 left, 3 right). `others`: more cards picked with it, e.g. the rest of a group of identical tokens (IGameController.selectCard otherCardViewsToSelect) |
| `{t:"selectPlayer", playerId:number, shift:boolean, button:number}` | click on a player |
| `{t:"ok"}` / `{t:"cancel"}` | the two prompt buttons |
| `{t:"answer", id:number, value:any}` | reply to `ask` |
| `{t:"useMana", color:"W"\|"U"\|"B"\|"R"\|"G"\|"C"}` | spend floating mana |
| `{t:"undo"}` / `{t:"concede"}` / `{t:"alphaStrike"}` | |
| `{t:"reorderHand", cardId:number, index:number}` | |

Everything except `startMatch`/`startState` is handled by `WebGameSession.onClientMessage` on WebEdt.

## Threading (server)

- Game thread: Forge calls IGuiGame methods. `ask` blocks it on a future until `answer` arrives
  (or the match is torn down, which completes it with a safe default).
- Netty I/O threads: only parse JSON and hand messages to WebEdt.
- WebEdt (`forge.web.WebEdt`): the single "UI thread". IGuiBase.invokeInEdt* and every
  IGameController call run here.
- Assists and `selectables.playerIds` are computed at decision points, only by a thread that owns
  the game: a game thread (in `awaitInput`, before each of the human's inputs, and before an
  `ask`), or WebEdt while every game thread is parked in `awaitInput` (the human's clicks change the
  game there, and only WebEdt releases those latches) and no mana ability is being activated for the
  current input on another game thread (paying mana nests a second game thread). The state flush
  never reads the game model.
