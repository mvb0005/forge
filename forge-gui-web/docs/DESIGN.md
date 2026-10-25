# Forge web UI: design

What the table looks like and how it behaves. The design canvas
(https://claude.ai/artifact/NtTZyzvhGvPdSgvrgP6V9j) has the mockups and the interactive prototypes
(phase flow, hover lab); this file is the written spec. [PLAN.md](PLAN.md) says what gets built
when, and lists the open questions (`Q-xx`) referenced below.

## Visual language (working assumption D-05)

Magic's own vocabulary, built from card-frame materials.

- **Table.** Each player's half is washed in their colour identity, taken from blurred art of their
  basic lands. The active player's half is brighter.
- **Type line.** The divider between the players reads like a card's type line:
  "Vex's Turn — Combat · Declare Blockers". In combat it moves up and turns ember.
- **Phase track.** Five gems (Beginning, Main, Combat, Main, End) styled as rarity symbols; past
  steps common black, upcoming uncommon silver, the current step mythic orange.
- **Life.** Engraved on a loyalty-shield shape. During combat it previews the result ("→ 14").
- **Lands.** Folded into a mana ribbon of mana symbols with counts; untapped mana you can use now
  glows. Expands to the real cards on demand.
- **Type.** Cinzel for names, numbers and banners; Crimson Pro for text (D-07).
- **Colour meanings** (one meaning each): frost = you can play or activate it; gold (breathing) =
  choose this now; brass ring = chosen; ember = attacking, threat, damage; steel = blocking,
  protection.
- **Playmats** are token sets: colour identity (default), any card's art, Lamplight felt, Midnight.

## The four layers ("quiet until asked")

| Layer | Gesture | What it holds |
|---|---|---|
| Glance | none | Only what changes your next decision: art, P/T, dangerous-keyword rings, verdict icons, life (with combat preview), phase, open-mana count |
| Peek | hover (~120 ms intent delay) | Large preview on the far side of the table plus a short, phase-aware answer; related cards light up |
| Inspect | deliberate (gesture is Q-03) | Pinned panel: full text, P/T by source, abilities and costs, history this turn |
| Survey | key or click | Threat lens (hold Alt), zone shelves, the log, Tab fan-out of all boards |

Rules: previews never cover what you're about to click; the board never moves on hover; anything
greyed out says why on hover; nothing needed for a decision exists only in a hover; keyboard focus
shows the same peek; touch uses long-press (Q-10).

What each object reveals at each layer is tabulated on the canvas page "Hover & disclosure".

### Keywords at glance level

| Tier | Keywords | Drawn as |
|---|---|---|
| 1 Danger | deathtouch, first/double strike, trample, menace, infect, lifelink | icon + word, ember ring |
| 2 Protected | hexproof, shroud, indestructible, ward N, protection | icon, steel ring; a lock instead of the gold pulse when you're choosing targets |
| 3 Evasion | flying, reach, can't be blocked | icon only |
| 4 Status | summoning sick, haste, vigilance, doesn't untap, goaded | small corner mark |

Keywords sit on a rail along the card's left edge. Counters are a gem at the top-left. The P/T plate
is parchment when printed, frost when raised, ember when damaged or lowered.

## The table through a turn

Each phase is a table mode; changing mode animates every card to its new place (see the phase-flow
prototype).

| Phase | Table | Action plate |
|---|---|---|
| Beginning | Your half brightens; permanents untap with a quarter-turn; upkeep triggers hang over the type line; the drawn card flies to the hand | Skipped unless a trigger needs you |
| Main 1 | Calm. Frost on what you can do; usable mana glows; opponents' open mana under their names | "To combat" |
| Declare attackers | Type line rises, the battle band opens, back rows fold away. Clicking a creature slides it into a lane with an arrow to its target | "Attack with N"; per attacker the engine's best-block outcome |
| Declare blockers | Each attacker gets a slot across the line. Pick a slot, then a creature, or drag. Legal blockers breathe gold; others dim and say why | "Confirm blocks"; verdict icons and life preview |
| Damage | First strike is its own beat. Numbers rise off struck cards, life ticks, the dead fly to the graveyard | Only if damage must be assigned (opens on the lane) |
| Main 2 | Band closes, survivors return tapped, marked damage stays as a chip | "End turn" |
| End | "Until end of turn" effects fade; discard only if over hand size | Banner hands the turn over |

Big banners only for the turn change and the start of combat; other steps just move the gem.
Pace setting: Cinematic / Brisk / Instant (AI turns follow it, Q-12).

## Combat

- **Lanes.** Attacker on its controller's side of the line, block slot on the defender's side.
  Empty slots teach the rule ("Flyer or reach to block · else 5 to you").
- **Verdicts** on the cards: skull = dies, check = survives; damage through on the slot.
- **Ledger** (what happens if you confirm): totals per player, including trigger effects and pump
  risk. At glance level it's the "Net −2 · 40 → 38" on the type line and the arrow on your shield;
  the full ledger is their peek.
- **Menace** shows as two stacked blockers; "needs a second blocker" until satisfied.
- **Huge attacks** (token armies) need grouped lanes: Q-04.
- All outcomes come from the engine (assist `combat`, `blockers`).

## Triggers and options

- **Lane chips.** A filled ⚡ on a card means it will trigger with things as they stand; a hollow ⚡
  means it could, depending on a choice still open. The chip sits on the card that triggers.
- **Peek** of a chip shows the card's exact trigger text and what fires it.
- **The ledger includes trigger effects** (Slashing Tiger's +2/+2 is why the Wall dies).
- **Grouped by player**, including players not in the fight.
- **What's available.** For you: everything you can respond with, from any zone. For opponents,
  public information only: open mana, hand count, abilities on board, graveyard casts.
- How exactly the engine can predict "will" vs "could" is a spike (Q-05). Ordering simultaneous
  triggers is Q-07.

## Zones

- One zone rail per player, fixed order: hand (opponents), library, graveyard, exile, command.
  Counts always visible; empty zones collapse to a line.
- Badges answer "can I use anything in here?": castable now (frost), castable later (ember),
  foretold / face-down counts.
- Opening a zone slides a shelf over the table (filters: All, Creatures, Castable). Castable cards
  can be cast from the shelf.
- Opponents' hands show the count plus cards you've seen (expiry rule: Q-08).
- Cards held in exile by a permanent show on that permanent, not in the exile pile.
- Designations (Monarch, Initiative, City's blessing) on the plaque; Day/Night on the type line.
- Zone changes animate to the pile, and the count bumps.

## Multiplayer (1–3 AI opponents)

- Opponents are seat strips: life, colours, open mana, hand, untapped power, "can hit you for N",
  zone counts with badges, commander and tax, ⚡ trigger count. Shapes over sentences.
- One opponent's battlefield is drawn full size: the attacker during combat, the controller of
  whatever just targeted you, else the one you clicked. Tab fans all boards out (Q-09).
- The full zone rail is yours; opponents' zones live in their strips.
- Combat lanes are grouped by defender; your group first and the only clickable one.
- Commander: commander damage per source on your shield (21 is lethal), tax on the command zone,
  turn order on the type line.

## Customization

Look, pace and help depth only, never layout or information rules.

- Playmat, sleeves, portrait (any card's art), frame metal (candidate to cut).
- Help level: Coach (rule hints, a confirm before an attack that leaves you dead on board), Player
  (default), Purist (board and highlights only). Help level changes peek depth, never the glance layer.
- Pace: Cinematic, Brisk, Instant. Stops: Smart (only when you can act), Every step, Custom.
- Accessibility: colour-safe highlights (patterns and shapes), reduced motion, larger text.
- Deliberately not settings: layout, zone positions, grouping, which keywords show, counter
  placement, overlay toggles.
