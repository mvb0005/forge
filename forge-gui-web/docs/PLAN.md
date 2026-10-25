# Forge web UI: plan

Living document. Refer to items by ID (`D-03`, `Q-07`, `M3.2`). To change the plan, edit this file;
status values are `todo`, `doing`, `done`, `parked`.

- Visual reference: the design canvas, https://claude.ai/artifact/NtTZyzvhGvPdSgvrgP6V9j
  (start at "Recommendation", then "Hover & disclosure"). The canvas is the reference for how things
  look; this file is the reference for what we build and in what order.
- Wire contract: [PROTOCOL.md](../PROTOCOL.md). Protocol changes go there first.
- Written design spec: [DESIGN.md](DESIGN.md). Build, run and test: [README](../README.md).

## Goal

A playable, modern single-player Forge client (you against 1–3 AI) that speaks Magic's visual
language, shows each phase of the turn clearly, and helps you decide without clutter. It must stay
fast on huge boards and be easy to extend.

## Principles

1. **The engine is the only source of rules.** The UI never computes outcomes, legality or
   triggers; the server sends them (`assist` messages). Layout and grouping are presentation and
   live in the UI.
2. **Quiet until asked.** Four layers: Glance (always on), Peek (hover), Inspect (deliberate),
   Survey (on demand). Nothing needed for a decision lives only in a hover.
3. **The table follows the turn.** Each phase has a table mode; moving between them is an
   animation, never a jump.
4. **Personalise the look, never the layout or the information rules.**
5. **Budgets are features.** Every milestone is measured against the performance budgets below.

## Decisions

| ID | Decision | Status |
|---|---|---|
| D-01 | Web UI (React 19, TS, Vite, Tailwind 4, Zustand) talking to a Java server over one WebSocket | locked |
| D-02 | Server projects engine views into DTOs; the browser never sees TrackableProperty | locked |
| D-03 | No rules logic in the client (principle 1) | locked |
| D-04 | Single player first; rooms and remote seats parked | locked |
| D-05 | Look: v2 card-frame language (type-line divider, rarity-gem phases, loyalty-shield life, mana ribbon) with v3 combat lanes. Each half is tinted in its player's colour identity, but with flat tones, not blurred land art (Matt liked the colours, not the land backgrounds) | locked |
| D-06 | Default help level "Player" (verdicts, ledger as peek); "Coach" and "Purist" optional | working assumption |
| D-07 | Fonts Cinzel + Crimson Pro (open-licence look-alikes of Beleren / Plantin) | working assumption |
| D-08 | Desktop app via Tauri later; browser for development | locked |
| D-09 | Hovering any card shows it big: after a dwell (~300 ms) the card itself grows in place, over its neighbours (they don't move), with the short peek answer beside it. Leaving shrinks it at once | locked |
| D-11 | Blocking one member of an attacking group: drop a blocker on the group's defend slot and one member animates out of the group into its own lane with that blocker; the group's count drops by one. Menace attackers always show two block slots (the second marked "second blocker needed"), and Confirm stays disabled with that reason until both are filled or the slot is empty, using `minBlockers` from the `blockers` assist | locked |
| D-10 | A group of identical tokens acts as one creature. Attacking: send N of the group (stepper; 0 / 1 / all are one click). Blocking an attacker with a group: buttons 0, 1 and X, where X is the fewest members that kill the attacker. X comes from the engine (`blockers` assist), never the client; no X button when 1 already kills it or no number does | locked |

## Architecture rules

### Server (`forge-gui-web`, Java)

- **Assist producers.** Every piece of engine-computed help is an `AssistProducer`
  (`kind`, `compute(game, seat)`) registered in one place. Producers run on the game thread at
  decision points (when the engine asks the human for input), never inside the state flush.
  Results are cached by `Game.cardsVersion` plus the decision being asked.
- **Projection.** All DTO fields come from `ViewProjector`. A new field means: PROTOCOL.md,
  `protocol.ts`, `ViewProjector`, in that order.
- **Hidden information.** Anything about another player's hidden zones is filtered on the server.
  "Seen cards" are tracked on the server, never inferred by the client.

### Protocol

- `hello` carries the protocol version and a capability list, so client and server can evolve
  separately.
- The game log is append-only (send new entries, not the last 200 every time).
- `selectables` gains `playerIds` (players you may click right now).

### Client (`forge-gui-web/ui`)

- **One card layer.** Every visible card is a single absolutely positioned element keyed by card
  id. Pure layout functions, one per table mode (`main`, `combat`, `fanout`), return a placement
  per card. Moving a card between zones, rows or modes is the same element animating
  (FLIP, transform and opacity only). No other code positions cards.
- **Subscriptions by id.** Components subscribe to one entity or to a structural signature
  (ids, zones, tapped, combat roles), never to the whole card map. A P/T change re-renders one
  tile, not the table.
- **Feature registries.** Features plug in instead of editing core files:
  - assist reducers by `kind`;
  - peek providers: `(entity, context) → sections`, shown by one popover system that owns the
    intent delay, far-side placement and keyboard focus;
  - keyword tiers: a data table (keyword → tier, icon, label, rule text).
- **Theme.** All colours, fonts and metals are CSS tokens. Playmats and frame metals are token
  sets; components never hard-code colours.

### Performance budgets

Measured on a production build (not dev mode) against two fixtures: the token pod (≈140
permanents) and a 4-player Commander board (≈600 permanents).

| Budget | Target |
|---|---|
| Server flush, p95 | ≤ 5 ms |
| Server assist compute at a decision point, p95 | ≤ 50 ms |
| Client: apply a one-card change and render | ≤ 8 ms |
| Client: phase transition animation | 60 fps, no layout reads during the animation |
| State message for a one-card change | ≤ 2 KB |

Measured (M1.1–M1.3, 2026-10-24, server only, `tools/smoke.mjs` against the jar):
- Server flush p95: 0.35–0.8 ms in 1v1 games, 0.8 ms in a 4-player game, 1.0 ms on the token pod (max ~150 ms: the
  first full state on a cold JVM).
- Assist compute p95 (cache misses only): `combat` ≤ 0.95 ms and `blockers` ≤ 0.3 ms (max 3.5 ms) on a warm JVM, token
  pod included. The first match after a cold start shows 5.6 ms / 1.8 ms (max 28 ms, JIT). Most `blockers` computes
  are cheap nulls outside declare blockers, so its max says more than its p95.
- One-card state message (non-full, exactly one card upserted or removed): when only cards change it is ≤ 1.6 KB in
  every run (token pod and 4 players included). When the same flush also moves a card between zones or changes the
  phase, it carries `game` and/or a whole `PlayerDto` (all its zone id lists): up to 2.7 KB in 1v1, 3.8 KB on the token
  pod (6 of 183 such messages over 2 KB). Getting those under 2 KB needs per-zone diffs. Protocol v1 sent the last 200
  log entries in `game` on every log line: about 14–17 KB for the same messages (estimate from the smoke test).

Measured (M1.4–M1.7, 2026-10-25, client, `/?bench=pod` and `/?bench=commander` on `vite build` + `vite preview`, Chrome,
2560×1215; the token pod fixture has 108 permanents, the Commander board 616, drawn as 214 card elements):
- One-card change applied and rendered (React commit plus forced style and layout, p95 of 100–200 runs, over several
  bench runs at 60–180 Hz): pod 1.6–2.1 ms, a member of a token group 5.6–7.7 ms (the group splits, so two elements change), during combat 2.6–3.4 ms; Commander
  3.3 ms, 3.5 ms in a group, 3.5 ms during combat. **Within the 8 ms budget.** The layout function doesn't run for a
  P/T change that leaves the group partition alone (tested).
- Phase transition (main ↔ combat). **The 60 fps budget is missed at the start of the transition.**
  - No layout reads during the animation (0, counted by the bench).
  - The animation frames: pod 59.4 fps average (p95 22 ms, 13 of 109 frames over 16.7 ms); Commander 54 fps (p95 28 ms,
    20 of 101), the slow ones near the end of the flight.
  - The frame that starts it: pod 60–66 ms, Commander 66–88 ms, a hitch of 3–5 frames. It holds the trigger (layout plus
    React commit: pod 12 ms, Commander 19–21 ms), then style and layout (20–30 ms) and paint. Most of the style and
    layout is card faces laid out again at a new width: 68 of 214 elements change width between modes on Commander,
    many by 1 px.
  - Next: keep card widths stable across modes where the lane allows (round them; don't shrink the back lanes by a
    pixel), draw card faces at a fixed size and scale them, and split the commit (attackers first).
  - The numbers swing with the browser's state (refresh rate 60–180 Hz; rAF throttled when the window isn't focused).
    The phase-transition figures are from focused runs at 60 Hz.

## Milestones

Each milestone ends playable. Exit criteria are the definition of done.

| ID | Milestone | Depends on | Status |
|---|---|---|---|
| M0 | Bridge and first board (done: server, protocol v1, lobby, dialogs, board, combat assist) | | done |
| M1 | Foundations: assist registry, protocol v2, card layer, table modes, popover system, perf fixtures | | todo |
| M2 | The look: type-line divider, shields, mana ribbon, colour-identity playmat, keyword rail, card tile | D-05, Q-01, Q-02 | todo |
| M3 | Phase motion: mode transitions, banners, combat band opening, zone flights | M1 | todo |
| M4 | Combat lanes with engine assists: legal blockers, outcomes including triggers, block-slot hints | M1, Q-04, Q-05 | todo |
| M5 | Disclosure: peek content per object, inspect panel, "why?" on disabled things, threat lens | M1, Q-03 | todo |
| M6 | Zones: rail, shelves, castable badges, seen-cards memory | M1, Q-06, Q-08 | todo |
| M7 | Multiplayer: seat strips, auto-focus, fan-out | M1, Q-09 | todo |
| M8 | Customization and accessibility | M2 | todo |
| M9 | Desktop packaging (Tauri) | | parked |

### M1 tasks

| ID | Task | Exit criteria | Status |
|---|---|---|---|
| M1.1 | Assist registry on the server; move `CombatAssist` into it and to decision points | No assist code in `flush`; existing combat assist unchanged on the wire | done |
| M1.2 | Protocol v2: version and capabilities in `hello`, append-only log, `selectables.playerIds` | Smoke test passes; a one-card change sends ≤ 2 KB | doing (card-only changes ≤ 1.6 KB; zone moves and phase changes still send whole `PlayerDto`s, up to 3.8 KB; needs per-zone diffs) |
| M1.3 | Legal-blockers assist (per attacker: who can block it, and why others can't) | Correct on menace, flying/reach and "can't block" fixtures | done |
| M1.4 | Client card layer and per-mode layout functions (main, combat) with FLIP | Cards move between rows and zones without remounting; layout unit tests | done (ui/src/table; 'fanout' is the main layout until M7) |
| M1.5 | Store subscriptions by id and structural signature | A P/T change re-renders one tile (React profiler) | done (proved with render counts in CardLayer.test.tsx) |
| M1.6 | Popover system and peek-provider registry | Intent delay, far-side placement, keyboard focus; two sample providers | done (ui/src/popover; I pins Inspect, Q-03; integration into tiles with M1.4) |
| M1.7 | Perf fixtures and a benchmark page (token pod, 4-player Commander) | Budgets measured and recorded in this file | done (measured; the start of a phase transition misses 60 fps, see Measured) |

## Open questions (need more thought)

| ID | Question | Options and current lean | Blocks |
|---|---|---|---|
| Q-01 | ~~Confirm the look~~ Resolved by D-05. Still open: the exact flat tone per colour pair | Lean: one token pair per colour, blended for multicolour | M2 |
| Q-02 | Mana symbols | Draw our own SVG set, or use an open-source mana-symbol font (licence to check). Lean: our own, small set | M2 |
| Q-03 | Inspect gesture. Right-click is already "remove from combat" in Forge (button 3 in InputAttack/InputBlock). The big card on hover is D-09; this is only the pinned panel | Hold (long-press) and a key (Space/I) to inspect; right-click keeps Forge's meaning. Lean: that | M5 |
| Q-04 | Huge attacks: 20–60 attackers (token armies) in lanes | Direction set by D-10 (a group is one lane, ×N). Splitting is D-11. Still open: the `blockers` assist field for X (lean: per attacker, per blocker group, `killWith: n \| null`) | M4 |
| Q-05 | "Will vs could trigger": how exact can the engine be? | Spike: mode matching is easy; evaluating trigger conditions against hypothetical blocks may be approximate or slow. Decide after the spike | M4 |
| Q-06 | "Castable now" badges and "you can respond with" need `getAllPossibleAbilities`, a known hot spot | Compute only at decision points, cache by `cardsVersion`; measure | M6 |
| Q-07 | Ordering simultaneous triggers | A sheet over the stack (not a modal); needs design | M5 |
| Q-08 | When do "seen cards" expire? | When that card leaves the hand, or the hand is shuffled or randomised | M6 |
| Q-09 | Tab fan-out of four Commander boards | Needs a design pass; depends on token and land folding holding up at quarter size | M7 |
| Q-10 | Touch support | Long-press must show everything a hover does; scope (tablet yes or no) undecided | M5 |
| Q-11 | Planeswalkers and battles at rest and as attack targets | Loyalty/defense shields; needs a board | M2 |
| Q-12 | AI turn pacing | Watchable at Brisk, skimmable at Instant; how stops interact with the AI's actions | M3 |

## Extension recipes

**Add engine-computed help (an assist kind)**
1. Describe the message in PROTOCOL.md under `assist`.
2. Add the type to `protocol.ts`.
3. Implement an `AssistProducer` on the server and register it.
4. Register a client reducer for the kind; render it through a peek provider or a glance element.

**Add hover content (a peek provider)**
1. Write a provider `(entity, context) → sections` in the feature's folder.
2. Register it; the popover system handles timing, placement and focus.

**Add a keyword**
Add a row to the keyword tier table (tier, icon, label, one-line rule). No component changes.

**Add a setting**
Only if it changes look, pace, help depth or accessibility (principle 4). Add a token set or a
store field, and a control on the settings sheet.
