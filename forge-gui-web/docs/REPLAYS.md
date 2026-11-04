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
each `state` message and the messages before it. The wait before a beat is the recorded gap, capped at
1 s, divided by the speed (1×, 2×, 4×, 8×). Pauses are short, and a busy AI turn still plays out at the
pace it was sent.

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
- Notices are cleared on every seek; while playing they show as they did.

### Whose view

A seat's file is what that seat saw: their hand, everyone else's hidden. Files from different seats can't
be merged into a full view, because the server filters each stream for its viewer, and AI seats have no
file at all. The options are watching one seat (and switching between the human seats' files), or a new
**all-seeing recording**: one more stream, projected for a viewer who may see every card (Q-R3).

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

## Decisions

| ID | Decision | Status |
|---|---|---|
| D-R1 | The viewer is the table in a `?replay` mode: no socket, input off, the store fed from the file | recommended; assumed for the prototype |
| D-R2 | Seeking uses keyframes built in the browser; the file format doesn't change for it | recommended; assumed for the prototype |
| D-R3 | Playback steps by beats (a state message and what came before it), each gap capped at 1 s, divided by speed | recommended; assumed for the prototype |
| D-R4 | A moment is match id, seat and `seq`; `&at=<seq>` opens it, after state `seq` | recommended; assumed for the prototype |
| D-R5 | `timer` and `ahead` are dropped in a replay; an open `ask` closes at the next `state` | assumed for the prototype (until Q-R4) |

## Questions for Matt

| ID | Question | Options and lean | Blocks |
|---|---|---|---|
| Q-R1 | Where the viewer is served from | Router path `/play/table/replay/` to any table pod (lean); a viewer-only Deployment; the tracker | R2 |
| Q-R2 | Who may watch a replay | Host and admins (today); every human seated in the game, any seat's file, once it's over (lean; needs the seats' people recorded in `play_games`); anyone signed in to the tracker | R2 |
| Q-R3 | A combined, all-seeing view | Only per-seat files, with a seat switcher (lean for now); add an all-seeing recording, maybe admin-only | R4 |
| Q-R4 | Record what each seat sent (answers, clicks) | Lean yes: one more line kind, `{ms, c:<client message>}`. The viewer closes asks exactly and can show "chose X" | R3 |
| Q-R5 | Retention | Keep everything (lean; ~250 KB a game, not backed up, as the terms already warn); or keep the last N per person | — |
| Q-R6 | Replays lost when a server dies | Accept; send what there is on shutdown (lean); checkpoints every turn | R3 |
| Q-R7 | Replays in the Discord Activity | Not now (lean); later a token-carrying route on the Activity hostname | R5 |
| Q-R8 | Show the moment on the live table so bug reports can cite it | Lean yes: "T31 · seq 965" in the table menu, copyable | R3 |

## Milestones

| ID | Milestone | Exit criteria | Status |
|---|---|---|---|
| R1 | **Watch a replay file** | The built UI's `?replay` mode opens a file (picker or drop) or `?replay=<url>`, draws the table as the seat saw it with input off, and has play/pause, speed, step, previous/next turn, a scrubber with turn ticks, phase jumps, and a copyable `&at=<seq>` link that reopens the same moment. A real replay plays and seeks; `tsc`, vitest and the build pass | doing (prototype on branch `replays/viewer`) |
| R2 | **Watch from the tracker** | The router serves `/play/table/replay/` (Q-R1); the play page's "replay" links open the viewer (download stays); the people allowed by Q-R2 see the game in their history and may open it | todo |
| R3 | **Better recordings** | Answers recorded (Q-R4), shutdown sends what there is (Q-R6), the live table shows its seq (Q-R8) | todo |
| R4 | **Other seats** | A seat switcher across the human seats' files, kept at the same turn and phase; perhaps the all-seeing recording (Q-R3) | todo |
| R5 | **Discord** | Q-R7 | parked |
