# Forge web UI: replays

Watching a finished game back in the browser. Same conventions as PLAN.md and MULTIPLAYER.md: milestones
end usable, exit criteria are the definition of done, D-R are decisions, Q-R are open questions. Builds on
the recording in PROTOCOL.md "Replays" and on M11 (the tracker connects people; a game server pod per game).

## Problem

Every hosted game is already recorded, one file per human seat, and the tracker keeps the files. But the
only thing anyone can do with one is download it. Matt wants to:

- watch a game back: play, pause, faster, jump to a turn or a phase;
- point at a moment in a bug report ("turn 31, seq 965") and have someone open the table at exactly that
  moment;
- eventually do that from the tracker's game pages, and maybe from the Discord Activity.

## What exists

Verified on 2026-11-03 by reading the code and running the checks named here.

- **Recording (game server).** `Recorder` holds one seat's replay in memory as gzipped JSON lines: a header,
  then `{ms, m}` for every message that seat was sent (connected or not), then a last line with
  `snapshot:true`, the result and a full state of the final board. `MatchHost` POSTs each file to
  `<replayUrl>/<matchId>/<seat>` when the match ends (finished, ended or abandoned). Only messages *to* the
  seat are recorded; what the player clicked or answered is not.
- **Store (tracker).** `mtgtracker/play/games.py` writes `replays/<matchId>-<seat>.jsonl.gz` beside the
  database (gzip checked, 64 MiB cap, a second upload replaces the first). Nothing deletes them. The
  restore points (`restore.py`) snapshot the database only, so replays are not backed up (assumed from
  reading `restore.py`, not tested).
- **Serving (tracker).** `GET /play/games/<matchId>/replay/<seat>` returns the file as `application/gzip`
  (no `Content-Encoding`), to the game's host or an admin only. `play_games` has one row per match, keyed
  to the host: guests in a multi-human game have no row, so they can neither see the game in their
  history nor download its replay.
- **What the tracker shows.** The play page's "Recent games" table (host's games, newest 12): when, deck,
  opponents, result, and a "replay" link per seat that has a file, which downloads it. There is no game
  page, and the Discord Activity shows no history.
- **Client.** `ui/src/replay.ts` parses a file and feeds a `hello` built from the header, then each
  message, into the real store. `replay.test.ts` checks a synthetic stream, and
  `ui/tools/replay.check.test.ts` checks a real file ends on its recorded snapshot. Nothing renders a
  replay.
- **A real file loads.** `forge-replay-3b7789995e8bfe90-seat0.jsonl.gz` (from Matt's Downloads, a
  4-player Commander game, 44 turns, 83 minutes): `replay.check.test.ts` passes. It is 227 KB gzipped,
  2.9 MB raw, 3,962 messages: 2,262 states (10 of them full, `seq` 1 to 2,262 with no gaps), 579 prompts,
  599 buttons, 220 playable, 97 selectables, 86 assists, 18 asks, 18 timers. The seat saw 71 cards at
  the end. Turn 1 starts 16 minutes in (seq 47), and turns 42 to 43 are 10 minutes apart: the clock in a
  replay is mostly people thinking or away.
- **Seeking cost (spike, since deleted).** Applying the whole file through the store in node takes 60 to
  110 ms, and parsing it 32 ms. The store's reducer copies on write (every `set` makes new maps and sets),
  so a saved `getState()` is a valid keyframe.

## Options

### Where the viewer lives

1. **The table itself, in a replay mode (recommended).** The built UI gets a `?replay` mode, like
   `?preview`: no socket, the store fed from the file, input turned off (`setSendTap` swallows every
   message), plus a control bar. Everything the player saw, drawn the way they saw it, and nothing to
   keep in step as the table changes.
2. A separate viewer page. Duplicates the table or draws less of it. No.

### How seeking works

The format is a message stream, so a position is "after the first N messages".

1. **Keyframes in the browser (recommended).** On load, apply the whole stream once and keep the store
   state every 100 messages. A seek is `setState(keyframe)` and then at most 99 messages. At about 100 ms
   for a whole 83-minute game, no server or format change is needed.
2. Periodic full states written by the server. They would speed up loading only, and loading is
   already fast. Not needed for seeking (they come back under loss below).

### Pacing

The recorded `ms` can't drive playback (16 minutes before turn 1). Playback steps one **beat** at a time:
a `state` message and the messages after it up to the next state (the prompt, buttons and choices on that
board). The wait before a beat is the recorded gap, kept between 120 ms and 1 s, divided by the speed (1×,
2×, 4×, 8×). Long pauses shrink to a second, and a burst of AI updates stays watchable.

### Positions and links

A moment is **match id, seat and `seq`**. `seq` is the state counter the seat was sent; it is contiguous
per seat (checked above). "At seq N" means after state N and every message before state N+1, so you see
the prompt, buttons and choices the player faced then. The viewer shows "Turn 31 · Combat · seq 965" and
a link button that copies the URL with `&at=965`. Turns and phases become ticks on the scrubber and jump
targets, read from `game.turn` and `game.phase` in the stream.

The live table shows `seq` nowhere today, so a bug report from a game in progress can't cite one yet
(Q-R8).

### Messages that don't replay as they are

- `timer` sets a countdown from `Date.now()`; `ahead` offers a button. Both are dropped.
- `ask` stays open until the client answers, and answers aren't recorded, so the viewer closes an open
  ask at the next `state` (the game thread is blocked until it's answered, so the next state comes after
  the answer). Recording answers would make this exact and could show what was picked (Q-R4).
- `reveal` stays until the player dismisses it, which isn't recorded either, so the viewer closes it at the
  next step or turn.
- Notices are cleared on every seek; while playing they show as they did.

### Whose view

A seat's file is what that seat saw: their hand, everyone else's hidden. Files from different seats can't
be merged into a full view, because the server filters each stream for its viewer, and AI seats have no
file at all. The options are watching one seat (and switching between the human seats' files), or a new
**all-seeing recording**: one more stream, projected for a viewer who may see every card (Q-R3).

Matt chose (2026-11-04): one recording per game, made by the server from the game, that shows everything
and any one seat, AI seats included, with the server deciding what each seat saw. See "One recording per
game" below.

### Who may watch

Today, the host and admins. Everyone in Matt's tracker is a friend behind Cloudflare Access, and once the
game is over hidden hands don't matter much, but the guests can't even see the game in their history yet
(Q-R2).

### Serving the viewer

The viewer is the game server's UI, and card images (`CardDto.img`, a relative `img/card/<key>`) are only
answered by a game server. A finished game's pod exits 10 minutes after the end, and the router sends a
gone table's id to `/play`. The replay file comes from the tracker, which is the same origin as the table
(`/play/...`), so the viewer fetches it with the person's own Access cookie and `readReplay` unzips it.

1. **A stable router path to any table pod (recommended).** The router sends `/play/table/replay/...` to
   the headless `tables` Service with `/replay` stripped. There is always a warm spare, and every pod
   serves the UI and card images. No new deployment. The page is then
   `/play/table/replay/?replay=/play/games/<matchId>/replay/<seat>`.
2. A viewer-only Deployment of the same image. Always the newest UI, but one more pod with a JVM in it.
3. The tracker serves the built UI. It has no JS build by rule, and it still lacks card images.

### Storage, retention and loss

- **Size.** About 230 KB for an 83-minute 4-player game; a thousand games is about 250 MB. Keeping
  everything is cheap.
- **Retention.** Q-R5.
- **A server that dies mid-game sends no replay.** The recording lives in the pod's memory. Options:
  1. accept it;
  2. on shutdown (SIGTERM: a deploy, a node drain, the abandon timer), finish and POST what there is,
     marked `interrupted`;
  3. checkpoint: at each turn boundary, POST everything so far (the tracker keeps the latest). A crash
     then loses at most one turn. Each checkpoint has to be a complete gzip file: a flushed stream has no
     trailer, and whether the browser's `DecompressionStream` accepts that, or several gzip members, is
     unchecked. A checkpoint without a `snapshot` line is a replay that stops early, which the viewer
     already handles (it never applies the snapshot).

  Recommended: 2 first (small, covers deploys), 3 if crashes turn out to matter.

### Discord

The Activity's hostname serves only the discord module and the table, outside Access (DISCORD.md), so
the replay route isn't reachable there. Watching in the Activity needs a token-carrying replay route on
that hostname. Later, if at all (Q-R7).

## One recording per game (R6)

Today's files are per seat and made from each seat's socket stream: AI seats have none, nobody's file shows
the whole table, a takeover once corrupted a seat's file, and 70% of the biggest file (953 KB, 72 full
states) is the full states sent on reconnects.

### How to record it

1. **Every seat's stream, all in one file.** Exact, but about 5 copies of the board: ~1 MB a 4-player game.
2. **Engine input (seed and decisions), re-run when served.** Smallest, but the engine isn't deterministic
   with AIs on a wall clock or humans (bench notes: AI timeouts change games), and serving needs an engine.
   No.
3. **One all-seeing stream with per-seat variants (recommended).** A **table session**: one more
   `WebGuiGame` like the spectator, never connected, that may see every card anyone may see. Its state
   stream is the base. Each card whose DTO differs for some seat (a hand card for the other seats, a
   face-down card's back, a library card a seat is searching) carries those seats' versions:
   `"as":{"2":<card as seat 2 sees it>}`. The variants are made by the same `ViewProjector.card`, with that
   seat as the viewer, so the engine still decides what each seat sees. Each human seat's own messages
   (prompt, buttons, choices, asks, reveals) are written in the same file, tagged with the seat. Stack,
   combat, log and players are the same for every viewer.

### How a perspective is served

The tracker keeps the one file and **projects** it when serving: for seat N it replaces every card that has
an `as.N` with it, drops `as`, sets `game.localPlayerIds` to that seat's player, and keeps only seat N's own
messages; for "everyone" it drops `as` and every seat's messages. The result is today's per-seat format
(`replay: 1`), so the viewer, keyframes, stops and `&at` don't change, and `seq` is the same number in every
perspective (switching keeps the moment). The browser gets only the perspective it asked for, and picks
nothing itself. Old per-seat files are served as they are.

The table shows a spectator's view for "everyone", with each hand drawn face up (display only: the server
sent the cards visible).

### Play from here

Forge can save a board as a `GameState` text and load it into a new game (puzzle mode, the bench's
`-state`/`-dump`, the control API's `state`). The table session saves one at the first main phase of every
turn (as the bench's `-dump` does) as a line in the replay; projecting drops them (they show libraries). To
play on from turn N, the control API takes the saved text (`stateText`) and seats: humans and AIs, in the
saved board's player order. What a saved board can't carry is listed under "Play from here: limits" below
once tested.

## Decisions

| ID | Decision | Status |
|---|---|---|
| D-R1 | The viewer is the table in a `?replay` mode: no socket, input off, the store fed from the file | recommended; assumed for the prototype |
| D-R2 | Seeking uses keyframes built in the browser; the file format doesn't change for it | recommended; assumed for the prototype |
| D-R3 | Playback steps by beats (a state message and what follows it up to the next), each gap kept between 120 ms and 1 s, divided by speed | recommended; assumed for the prototype |
| D-R4 | A moment is match id, seat and `seq`; `&at=<seq>` opens it, after state `seq` | recommended; assumed for the prototype |
| D-R5 | `timer` and `ahead` are dropped in a replay; an open `ask` closes at the next `state`, and a `reveal` at the next step or turn (the player's dismissing it isn't recorded) | assumed for the prototype (until Q-R4) |
| D-R6 | One recording per game, made by a never-connected table session that sees every card anyone may see; cards that a seat sees differently carry that seat's version (`as`); human seats' own messages are in it, tagged with the seat (option 3 above) | Matt asked for it 2026-11-04; prototype on `replays/server` |
| D-R7 | The tracker projects a perspective (a seat, or everyone) when serving, into the per-seat format the viewer already reads; the browser never picks what a seat may see | prototype |
| D-R8 | The recording saves a `GameState` at each turn's first main phase; "play from here" starts a new game from one, by the control API's `stateText` | prototype |

## Questions for Matt

R1 is UI only, so Q-R1, Q-R2 and Q-R5 to Q-R8 weren't needed for it: the prototype assumes nothing about them.

| ID | Question | Options and lean | Blocks |
|---|---|---|---|
| Q-R1 | Where the viewer is served from | Router path `/play/table/replay/` to any table pod (lean); a viewer-only Deployment; the tracker | R2 |
| Q-R2 | Who may watch a replay | Host and admins (today); every human seated in the game, any seat's file, once it's over (lean; needs the seats' people recorded in `play_games`); anyone signed in to the tracker | R2 |
| Q-R3 | A combined, all-seeing view | Answered 2026-11-04: one recording, every perspective (D-R6) | — |
| Q-R4 | Record what each seat sent (answers, clicks) | Lean yes: one more line kind, `{ms, c:<client message>}`. The viewer closes asks exactly and can show "chose X". Assumed for the prototype: not recorded; asks close at the next state (D-R5) | R3 |
| Q-R5 | Retention | Keep everything (lean; ~250 KB a game, not backed up, as the terms already warn); or keep the last N per person | — |
| Q-R6 | Replays lost when a server dies | Accept; send what there is on shutdown (lean); checkpoints every turn | R3 |
| Q-R7 | Replays in the Discord Activity | Not now (lean); later a token-carrying route on the Activity hostname | R5 |
| Q-R8 | Show the moment on the live table so bug reports can cite it | Lean yes: "T31 · seq 965" in the table menu, copyable | R3 |
| Q-R9 | Who may watch "everyone" and another seat's view | Whoever may watch the game may pick any perspective (lean, assumed; once it's over hands don't matter much); or a player sees only their own seat until an admin opens it up | R6 |
| Q-R10 | Who may play from here, and who sits where | Whoever may watch the replay; they take the seat they watch (or seat 1 from "everyone") and AIs take the rest (lean, assumed); later invite the original players | R7 |
| Q-R11 | Keep sending the old per-seat files during the change | No: the tracker learns the new file first, then the game server switches (lean, assumed) | R6 |

## Milestones

| ID | Milestone | Exit criteria | Status |
|---|---|---|---|
| R1 | **Watch a replay file** | The built UI's `?replay` mode opens a file (picker or drop) or `?replay=<url>`, draws the table as the seat saw it with input off, and has play/pause, speed, step, previous/next turn, a scrubber with turn ticks, phase jumps, and a copyable `&at=<seq>` link that reopens the same moment. A real replay plays and seeks; `tsc`, vitest and the build pass | prototype done 2026-11-03 on branch `replays/viewer`, not reviewed (below) |
| R2 | **Watch from the tracker** | The router serves `/play/table/replay/` (Q-R1); the play page's "replay" links open the viewer (download stays); the people allowed by Q-R2 see the game in their history and may open it | todo |
| R3 | **Better recordings** | Answers recorded (Q-R4), shutdown sends what there is (Q-R6), the live table shows its seq (Q-R8) | todo |
| R4 | **Other seats** | A seat switcher across the human seats' files, kept at the same turn and phase; perhaps the all-seeing recording (Q-R3) | todo |
| R5 | **Discord** | Q-R7 | parked |
| R6 | **One recording per game** | D-R6, D-R7: one file per game; the viewer switches between everyone and any seat (AI seats too), keeping the moment; a projected seat matches what that seat's own stream showed; old files still open | prototype on `replays/server` |
| R7 | **Play from here** | D-R8: from a replay's turn, a new live game starts on that board with the seats people or AIs; the limits are written down | prototype on `replays/server` |

### R1: the prototype

`ui/src/replay.ts` (`indexReplay`, `seekReplay`, `advanceReplay`, `stopAtSeq`, `beatMs`) and
`ui/src/shell/Replay.tsx` (the page and its control bar). Keys: Space plays and pauses, ← and → move a step
(phase), Shift+← and Shift+→ a turn, `,` and `.` one update. A move of one update forward applies just
that update, so the table animates as it did live; any other move seeks.

To try it: download a replay from the play page's "replay" link, run a local game server (README "Run")
and `npm run dev` in `ui/` (it proxies card images to the server; `FORGE=host:port`), open
`http://127.0.0.1:5173/?replay` and pick the file. Without a server it works too, with no card images.
To test `?replay=<url>` and `&at=`, pass the game server a copy of `ui/dist` with the file in it as `--ui`
and open `http://127.0.0.1:<port>/play/table/?replay=<file>&at=965`.

Checked on 2026-11-03 with the real file above, the built UI and a local game server (Chrome, window focused):

- it opens at `&at=965` on turn 27, main phase, seq 965, with that turn's stack, prompt and log;
- turn and step jumps, single updates, the scrubber and play at 2× all move the readout and the address
  bar's `at` as expected, and the end shows the game-over result;
- a file given to the picker loads the same way;
- cost in the browser, from the key press to React's commit (paint not included): a single update 10 to
  40 ms, a turn jump 55 to 80 ms, a scrubber seek across the game 50 to 110 ms;
- `tools/replay.check.test.ts` also seeks to 60 stops across the file and checks that each board, prompt
  and ask match playing through (each seek under 100 ms in node; indexing the whole file takes 130 ms).

Not done in R1: the tracker link and serving (R2), and a look at the bar in light mode or on a small screen.
