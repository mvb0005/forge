# Auto-passing: stops and yields

Design for richer auto-passing at the web table (M14). Living document: refer to items by ID (`Q-A3`,
`M14.1`). [MULTIPLAYER.md](MULTIPLAYER.md) M12 and M12.1 come first (auto-pass when no actions, the respond timer,
per-step stops, passing ahead); this builds on them. Protocol changes go in [PROTOCOL.md](../PROTOCOL.md) first.

## Problem

Priority asks you far more often than you have something to say. In a four-player pod every spell, every trigger and
every step where your stops apply is a prompt for each seat that holds anything castable, and each one costs a click
or up to 10 s of the respond timer. Matt wants auto-passing he can steer:

- pass until something targets me or my permanents;
- pass until a given player's end step (or another chosen step or turn);
- pass unless I can respond meaningfully (a counterspell I could cast), never stopping just because a mana ability
  counts as an action;
- smart stops: an opponent casts something, combat involving me, triggers I control.

Rules stay in the engine: every condition is evaluated on the server, against the game. The UI only chooses
conditions and shows what the server says (PLAN.md principle 1, D-03).

## What exists

### The web table today (verified in code)

- **Auto-pass when no actions** (`YIELD_AUTO_PASS_NO_ACTIONS`, "APINA"), on for every seat (WebMain sets it in the
  process-wide FModel preferences). At each priority `PlayerControllerHuman.chooseSpellAbilityToPlay` runs
  `AvailableActions` (forge-ai) and passes without asking when it finds nothing.
- **Stops.** With an empty stack, `WebGuiGame.isUiSetToSkipPhase` asks only in fixed steps: `MY_STOPS` (main 1,
  declare attackers, declare blockers, first strike damage, main 2) and `THEIR_STOPS` (beginning of combat, declare
  attackers, declare blockers, first strike damage, end step). The same for every seat, whether or not the combat
  involves you. A non-empty stack always asks (when you have an action).
- **End Turn.** With nothing to undo, Cancel at a priority prompt is Forge's End Turn: upstream's
  "auto-pass until end of turn" yield (`YieldController.setAutoPassUntilEndOfTurn`), interrupted by upstream's
  interrupt preferences, which on the web are FModel's defaults, shared by all seats.
- **Respond timer** (10 s while responding, never on your own empty-stack turn or the combat steps) and **pass ahead**
  (`PassAhead`, M12.1). `PassAhead.open` uses the same static `stopsAt`.

### Upstream Forge (docs/Advanced-Yield-Options.md, `forge-gui` `YieldController`)

Upstream already has most of the machinery, per human controller:

- **Yields**: until end of turn; until the stack empties (interruptible or not); a **marker**, "until player P's step
  S" (one at a time, cleared when reached, with care for a marker set at or past its step).
- **Interrupts** that end a yield: attackers declared against you (or your planeswalkers), an opponent casts a spell
  or activates an ability, you or your permanents are targeted (`targetsPlayerOrPermanents`, including sub-abilities),
  mass removal (DestroyAll/DamageAll/SacrificeAll/ChangeZoneAll), any trigger on the stack, reveals.
  `HostedMatch` subscribes each human's `YieldController` to game events, so these already fire for web seats.
- **Per-controller preferences**: `YieldController.setPref` keeps overrides that win over FModel. That is how a
  web seat can have its own settings without touching the shared FModel.
- **Suggestions** ("you can't respond; yield?") and a calculation budget for the action scan (dynamic: 50 ms per
  card in hand, battlefield and external zones, clamped to 50 to 1500 ms; on timeout every unvisited card counts as
  actionable, so a timeout means an extra prompt, never a missed one).

What upstream doesn't have: stops that depend on the situation (combat involving you), a way to say why a yield
ended, per-seat settings on one host process, and a finer idea of a "meaningful" action.

### What counts as an action (verified in code)

`AvailableActions.cardHasActionable` counts a card when one of its `getAllPossibleAbilities(player, true)` (timing
already checked) is **not a mana ability**, is affordable (`ComputerUtilMana.canPayManaCost`) and has legal targets.
It scans hand, battlefield and `Flashback` (cards castable from other zones). So tapping a land, a mana rock or a
Treasure never counts today; "a land counts as an action" is not the cause of pointless stops. What does count:
any non-mana activated ability you can pay for (firebreathing, fetchlands, manlands, Clues, Food, cycling in hand),
and every affordable instant, whatever is on the stack. The scan runs at every priority already (highlights are on,
so it walks every card rather than stopping at the first hit); the web reuses the result for the `playable` message.

### Spike: where the prompts go (2026-11-03)

Temporary logging at every priority prompt (seat, step, stack size, attacked or not, what the scan found), two smoke
runs against a local server: a 4-player Commander game of random precons, and `token-pod-turn12.txt` (passive).
The smoke player plays its hand out, so it rarely holds instants: the numbers show the shape, not a real player's
counts. 92 priority prompts in all:

| Where | Prompts |
|---|---|
| Your turn, empty stack (main 1, main 2, attacks) | 60 |
| Your turn, something on the stack (assumed mostly your own spells and triggers: the log didn't record whose) | 12 |
| Their turn, beginning of combat | 3 |
| Their turn, declare attackers / blockers, **you not attacked** | 4 |
| Their turn, declare attackers / blockers, you attacked | 2 |
| Their turn, end step | 3 |
| Their turn, something on the stack | 8 |

- No scan timed out (no `AvailableActions: heuristic timed out` line). No mana ability ever made a prompt.
- While responding, the cards that made you stop were an instant in hand (Comet Storm, 30 prompts) and a
  firebreathing creature (Furnace Whelp, 3).
- So, beyond your own turn: combat you're not in, and priority right after your own spell, are pure overhead; the
  rest are real windows where only you can tell whether your instant matters.

## Design

Four layers, all evaluated on the game thread where the engine asks for priority. Only `InputPassPriority` is ever
answered automatically.

1. **Floor: nothing meaningful to do → pass.** APINA, as today, on the engine's scan. Later, minus abilities you
   muted (below).
2. **Stops (standing).** With an empty stack, which steps ask you. Per seat, and situational:
   combat steps on someone else's turn ask only when the combat involves you.
3. **Yields (until a condition).** "Pass until X": end of turn, my next turn, player P's end step, the stack resolves.
   While a yield runs, every priority passes, the stack included.
4. **Interrupts (standing).** Events that end a yield and hand priority back: attacked, targeted, mass removal, an
   opponent's spell, a trigger you control.

How they combine at a priority:

```
yield active and not ended        → pass (shown as "Passing until …")
nothing meaningful (floor)        → pass
stack not empty:
   top is yours, not a trigger    → pass, unless you hold priority (MTGO's default)
   otherwise                      → ask
stack empty                       → ask if this step is one of your stops
```

A yield ends when its target arrives (the marker is cleared at that priority), or when an interrupt fires; after
that the normal rules decide, so reaching "my next turn" doesn't ask in upkeep, it lets your usual main 1 stop do it.
An interrupt at a moment you can't act still passes (the floor), but the yield stays ended and the table says why.

### What counts as meaningful

Options:

- **A. The engine's scan as is** (non-mana, affordable, targetable, timing-legal). Already computed, already safe.
  Mana abilities never count. Pump and utility abilities do.
- **B. A plus mutes.** "Don't stop for this": a per-ability mute, chosen by you from the card (its inspect panel or
  the "why" line), for the rest of the game. The scan skips muted abilities. Exact, no heuristics, and stays a
  choice the player made; the engine still decides everything else.
- **C. Heuristics in the engine** to drop "routine" abilities (cycling, Clue/Food, firebreathing outside combat,
  fetches). Fragile: every one has a case where it matters, and a false negative passes through a real answer.
- **D. Stack relevance**: while the stack has something, count only answers that can touch it (a counter that can
  target it; protection for a threatened permanent, via the AI's `ComputerUtil.predictThreatenedObjects`). Strong
  but expensive and approximate; the AI's prediction misses cases.

**Recommendation: A now, B in M14.2, D only as an opt-in interrupt ("stop when my stuff is threatened") later.**
B needs a small hook in `AvailableActions` (a skip predicate) or our own copy of its walk in forge-gui-web; the copy
keeps upstream untouched (Q-A6).

Cost: the scan already runs at every priority for highlights (it walks every card). Mutes add a set lookup per
ability. Nothing new runs per state flush. The scan changes game state (it runs under a temporary AI controller), so
it may only run on the game thread at the decision point, never from WebEdt or the network threads; everything
those threads read (stops, yield state) must be plain state the game thread wrote.

### Stops

Per seat, with these defaults (the static sets today, made situational):

| Step | Your turn | Their turn |
|---|---|---|
| Upkeep, draw | no | no |
| Main 1 | yes | no |
| Beginning of combat | no | 1v1 only (tap or kill a would-be attacker); in a pod, no (Q-A2) |
| Declare attackers | yes (you attacked) | only if you or your planeswalkers / battles are attacked |
| Declare blockers | yes | only if you're in the combat |
| First strike damage | yes | only if you're in the combat |
| Main 2 | yes | no |
| End step | no | yes |

"In the combat": some attacker attacks you, a planeswalker you control, or a battle you protect. The engine's
`Combat` answers that; the client never infers it.

Later (M14.3): a stops sheet with "Smart" (these), "Every step" and per-step toggles for your turn and theirs
(DESIGN.md's "Stops: Smart / Every step / Custom"), and a "stop for every combat" switch.

**Your own spell on top.** After you cast a spell or activate an ability you get priority again with it on top.
MTGO passes there unless you hold priority; Forge asks. Recommendation: pass when the top item is your own spell or
activated ability (not a trigger), with "Hold priority" as a toggle in the pass menu for the rare time you respond to
yourself (Q-A3). Your own triggers still ask (Matt's "triggers I control"). It passes only the first time: when your
item is back on top after someone's response resolved, you're asked, since that response may need an answer.

Cost: in this fork that prompt is also where Cancel is "Undo" (an undo checkpoint is taken at every priority prompt,
verified: Ann's Cancel there reads "Undo" in `tools/autopass.mjs`). Passing it means a cast on your own turn can't be
taken back from that prompt any more (Q-A8).

### Yields and how long they last

| Yield | Ends | Upstream piece |
|---|---|---|
| End of turn (End Turn button) | at cleanup, or an interrupt | `setAutoPassUntilEndOfTurn` |
| Until my next turn | at your upkeep, or an interrupt | marker (you, upkeep) |
| Until P's end step | at P's end step, or an interrupt | marker (P, end of turn) |
| Until the stack resolves | stack empty, or an interrupt | `setAutoPassUntilStackEmpty(true, true)` |

One yield at a time (upstream's rule): choosing another replaces it. Durations: a yield lasts until its condition;
stops, interrupts and mutes are standing settings. Whether standing settings outlive the game is Q-A5.

**Interrupt defaults for a web seat** (per seat, `YieldController.setPref`, never FModel):

| Interrupt | Default | Why |
|---|---|---|
| Attackers declared against you | on | combat involving you |
| You or your permanents targeted | on | Matt's first example |
| Mass removal | on | it hits you without targeting |
| An opponent casts a spell or ability | **off** | on, "until my next turn" ends at the first spell in a pod (Q-A1). This also changes the existing End Turn button: it no longer stops when an opponent casts something (it used FModel's default, on) |
| A trigger you control | off (upstream's is "any trigger"; ours would be yours only) | M14.3 |

### How it looks

Built in M14.1: the menu (above the plate's buttons, not a chevron on OK), "Passing" in the headline and dock, and
"Stopped passing: …". Not built: the ⏩ mark on the target player's plate and the F2/F3 keys.

- **Pass menu.** A small chevron button beside OK ("Pass ▾") opens a short list: *Until end of turn*,
  *Until my next turn*, *Until Ann's end step* (one per opponent), *Until the stack resolves* (only when it isn't
  empty), and *Hold priority after my spells* (a check). Tap targets, no hover, no right-click: it works in the
  Discord Activity's small frame. Escape closes it. Keyboard: F2 end of turn, F3 my next turn (Q-A4).
- **While passing.** The headline says it in the waiting style: "Passing until Ann's end step" with a *Stop*
  button (Esc). The target turn's player plate carries a small ⏩ mark. The phase gems are generic (five per turn,
  not per player), so they don't get per-step marks in M14.1; per-step stops on the strip need a per-player strip
  and are M14.3 if Matt wants them.
- **Why it stopped.** When an interrupt ends a yield, the server says why: "Stopped: Ann cast Shock targeting your
  Llanowar Elves", "Stopped: Ben attacks you". It shows above the prompt until the next priority, and the stack item
  is pointed at (as a cancelled pass ahead does). When you're asked while responding, the line under the headline
  names what the engine found you could do ("You could cast Comet Storm"), from the `playable` cards; that is where
  M14.2's "Don't stop for this" sits.

### Protocol (cap `autopass`)

Server → client: `{ t:"autopass", yield: { kind, label, playerId? } | null, stopped?: string, stackId?: number,
hold: boolean }` when this seat's yield starts, ends or the hold setting changes. `kind` is `turn`, `nextTurn`,
`endStep` or `stack`; `label` is the server's words ("Passing until Ann's end step"); `stopped` is why it ended
early.

Client → server: `{ t:"yield", kind, playerId? }`, `{ t:"unyield" }`, `{ t:"holdPriority", on }`. Later:
`{ t:"mute", cardId, ability }` and `{ t:"stops", ... }`.

### Safety

- Only a priority pass is ever made for you. Yields go through `mayAutoPass` in `chooseSpellAbilityToPlay`, which
  only answers priority; targets, modes, attackers, blockers, damage assignment, mana payment, the floating-mana
  prompt, triggered "may" choices and every `ask` still wait for you, timer-free, yield or not.
- The respond timer is untouched; a yield just means fewer prompts to time.
- Pass ahead stays consistent: a seat that is yielding, or whose stops don't ask at this step, is never offered
  "Pass ahead" (`PassAhead.open` asks the seat's own stops and yield, not the static sets).
- Multiplayer pacing: every pass a yield makes is a pass the others don't wait for. Nothing about a seat's yield
  is sent to other seats (no tells).
- Discord Activity: same table; the menu is tap-first and fits 390 px.

### Reusing upstream

Reuse, don't rebuild: `YieldController` holds the yield state and the interrupts and is already subscribed to the
game. The web only drives it (`IGameController.sendYieldUpdate` with `SetMarker`, `ClearMarker`, `StackYield`,
`SetAutoPassUntilEndOfTurn`), sets per-seat preferences through `YieldController.setPref`, and reports state by
overriding `AbstractGuiGame.applyYieldUpdate` / `updateAutoPassPrompt` in WebGuiGame. Stops stay web-side
(`isUiSetToSkipPhase`), as now. No edits to `forge-gui` in M14.1, so upstream merges stay clean. Upstream's yield
suggestions stay off (APINA already covers them).

## Decisions for Matt

| ID | Question | Lean | Prototype |
|---|---|---|---|
| Q-A1 | Should "an opponent casts something" end a yield by default? | Off: in a pod it ends "until my next turn" at once. On for "until the stack resolves" doesn't matter (it ends anyway) | assumed off |
| Q-A2 | Their beginning of combat: stop in a pod? | 1v1 yes, pod no (you can't know yet who they'll attack) | assumed |
| Q-A3 | Pass priority right after your own spell or ability (MTGO style), with a Hold toggle? | Yes; your own triggers still ask | assumed yes |
| Q-A4 | Keyboard shortcuts for yields | F2 until end of turn, F3 until my next turn; none for per-player | no shortcuts yet |
| Q-A5 | Do standing settings (stops, interrupts, mutes, hold) outlive a game? | Kept by the client (localStorage) and sent at connect; the tracker doesn't need them | per game only |
| Q-A6 | Muting abilities (M14.2): a hook in upstream's `AvailableActions` or our own copy of its walk? | Our own copy in forge-gui-web: no upstream edits, and it can say which ability made you stop | not built |
| Q-A7 | Should reaching a yield's target always ask, even with nothing to do? | No: the target ends the yield and your stops decide (so "my next turn" doesn't ask in upkeep) | assumed no |
| Q-A8 | Passing after your own spell skips the prompt where Cancel is Undo. Keep the pass (and lose that take-back), keep asking when Undo is available (and lose most of the gain on your own turn), or move Undo off that prompt (e.g. a Z / undo button that works while waiting)? | Keep the pass, and make Undo reachable without that prompt (Z already sends `undo`; check what the engine allows once priority has moved on) | pass kept; undo not checked |

## The M14.1 prototype

Built on branch `web/auto-pass` with the "Prototype" column's choices. Nothing in `forge-gui` changed.

- Server: `Stops` (the stop table above, combat involvement, "your own item on top"), `Yields` (kinds to upstream
  yield updates, the running yield's label, reached or interrupted, and why), `WebGuiGame` (`isUiSetToSkipPhase`
  asks `Stops`; `passNow` passes a priority prompt without sending it when a pass ahead reaches the seat or its own
  item is on top; the `autopass` message; `yield` / `unyield` / `holdPriority`; per-seat interrupt defaults on the
  seat's `YieldController`), `PassAhead.open` asks the seat (`wouldAsk`). Cap `autopass`.
- Upstream ends "until the stack resolves" only at the seat's next priority; the web ends it when the stack empties
  (`updateStack`), so the table doesn't say "Passing" in between.
- UI: `shell/PassMenu.tsx` ("Pass until…" above the plate's buttons, or "⏩ Passing until … · Stop" while a yield
  runs); the headline and the dock say "Passing" and the yield, and "Stopped passing: …" after an interrupt,
  pointing at the stack item. Cancel (Esc) on the engine's "Yielding until …" prompt stops the yield; a real
  decision while passing (the cleanup discard, a reveal, targets) shows as itself and keeps its own Cancel.
- Tests: `AutoPassTest` (engine, 16 cases: stops, involvement, own top, what the scan counts, yields, why),
  `tools/autopass.mjs` (two human seats: own Shock passes, stack yield, end-step yield not stopped by a spell at
  someone else, stopped by one at you, reached at the end step; your own Shock back on top after a response asks),
  `PassMenu.test.ts`. `tools/passahead.mjs` now sets Ann to hold priority, since she responds to her own Shocks, so
  it no longer covers the default path; `autopass.mjs` does.

Try it: build the jar and the UI, start a server, then `node tools/start.mjs` (Commander, 3 AIs) and open the seat
link. Cast a spell: you aren't asked again with it on top. Open "Pass until…" and pick an opponent's end step; an
attack on you or a spell at you stops it and says why.

Checked in Chrome (desktop width) on a Commander game against 3 AIs: the menu lists the opponents in turn order
after you; "until my next turn" went from turn 2 to turn 6 without a prompt; the cleanup discard was still asked
while passing. Not checked: the 390 px Discord frame (the window resize didn't take).

Known gaps: the menu sits above the plate's buttons rather than as a chevron on OK; a skipped priority prompt still
sends its `selectables`/`playable` (harmless, replaced at once); "why" reads the game when the interrupt fires, so
it names the top of the stack, which is the spell that interrupted.

## Milestones

| ID | Milestone | Exit criteria | Status |
|---|---|---|---|
| M14.1 | **Fewer pointless stops** (least work, most stops removed). Situational combat stops on others' turns; their beginning of combat only in 1v1; pass after your own spell unless holding; the pass menu with the four yields on upstream's `YieldController`; per-seat interrupt defaults; the `autopass` message with "Passing until …", Stop, and why it stopped; `PassAhead` asks the seat's real stops | Engine tests for the stop and yield decisions; smoke and passahead pass; the menu works at 390 px | prototype, 2026-11-03 (assumptions marked above; the 390 px check not done) |
| M14.2 | **Why and mute.** "You could …" line from the scan; "Don't stop for this" per ability; our own scan with a skip set (Q-A6) | A muted Clue no longer stops you; tests | todo |
| M14.3 | **Stops sheet.** Smart / Every step / Custom per step, stop for every combat, interrupts as toggles, trigger-you-control interrupt; settings kept across games (Q-A5) | Settings survive a reconnect and a new game | todo |
| M14.4 | **Threatened.** Opt-in interrupt when the stack threatens your stuff without targeting (the AI's threat prediction), measured against the 50 ms assist budget | p95 within budget on the Commander bench board | todo |
