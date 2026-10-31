# Forge web UI: multiplayer plan

Milestone M11 in PLAN.md. Same conventions: milestones end playable, exit criteria are the
definition of done, D- are decisions, Q- are open questions.

## Goal

Friends play a Commander pod together at `<tracker host>/play`, each with a deck from their own
tracker account. The players are people Matt has added to mtg-tracker. A table seats 4 by default
(configurable), with curated AIs in the seats no human takes. A game server hosts exactly one table
(D-M1). More tables later means more game servers (M11.5, deferred). Waiting on other people is
cut down later (M12), not first.

Far future: the same table as a Discord game (a Discord Activity: the web client in Discord's
iframe, people known by their Discord id). Nothing here builds that, but identity stays behind one
"person" key so a second sign-in source can be added (D-M3).

## Where we are

- **One table already.** `MatchHost` is "the one table": one socket, one seat, one running match.
  A second person is refused with "X is already at this table" (close code 4000). With one table
  per server this stays; what changes is that the table gets several seats.
- **The engine already handles several humans.** `HostedMatch.startMatch` takes a map from
  `RegisteredPlayer` to `IGuiGame`. Forge's own network server gives each remote player a
  `RemoteClientGuiGame`. `AbstractGuiGame.mayView` hides cards per local player, so one
  `WebGuiGame` per human seat gets per-viewer hiding for free.
- **Identity is Cloudflare Access.** A seat is a verified email. Tracker decks are read in the
  browser with the player's own sign-in, so that part works per player unchanged.
- **Single-human assumptions.**
  - Without Access the human is the static `GamePlayerUtil.getGuiPlayer()` ("Human"), so two of
    them would collide.
  - `MatchHost` holds one channel, one seat token, one owner.
  - `PlayLog` records one email per game.
  - Match end disposes the session and sends the lobby.
  - Assists, notices and reveals assume the only human is the viewer.
- **One UI thread.** `WebEdt` is a static single-thread executor shared by Forge's
  `IGuiBase.invokeInEdt*` and every client action. With one table per server it serves one match,
  as now; several humans only add more client messages to it.
- **Capacity.** The `forge-web` container has `-Xmx2g` and no CPU limit, on a Docker host shared
  with other servers. The bench stack measured the AI at about 85% of CPU in a 4-player pod.

## Shape

```
WebServer ── sockets ──> MatchHost (the table)
                         ├─ seats: human(person) | ai(opponent id), 4 by default
                         ├─ lobby state: host, format, seat count, decks, ready
                         ├─ HostedMatch + game thread
                         └─ one WebGuiGame per human seat ── that person's socket
```

- **The table.**
  - The first person to sit down while the table is free is its host and sets it up as today:
    format, deck, opponents.
  - While it's in use, everyone else sees who is playing. Only invited people can take a seat;
    everyone else gets "Matt's table is in use".
  - When the match ends the table returns to its lobby with the same seats, ready for a rematch.
- **Seats.**
  - 4 seats by default; the host can change it (2 to 4).
  - The host invites people from their tracker people list (friends). A seat no human takes is
    played by a curated AI the host picks; the default is a different roster commander per seat.
  - An invited friend opens `/play`, sees the table, and takes their seat. They pick a deck from
    their own tracker on the same page as today, which sends the decklist text with "ready".
  - The match starts when the host starts it and every human seat is ready.
- **Per-viewer everything.**
  - Each human seat gets its own `WebGuiGame`, projection, assists, notices and reveals.
  - The protocol gains a server-sent `waiting` field naming who the engine is waiting on and for
    what: priority, targets, mulligan or a choice. With two humans, "not your priority" no longer
    tells the client who is acting, so the headline can't infer it.
- **Losing doesn't end the match.**
  - A player who loses or concedes gets "You're out: watch or leave".
  - The match ends when the engine says so.
  - The play log keeps a participant list, so the game shows in every player's history.

## Decisions

| ID | Decision | Status |
|---|---|---|
| D-M1 | One table per game server. It keeps games sandboxed from each other (Forge has never run several matches in one JVM) and avoids a table registry. More tables means more servers (M11.5) | locked (Matt) |
| D-M2 | Rules stay in the engine. Seat state, readiness and "waiting on" come from the server; the client displays them | locked |
| D-M3 | A person is one key: today their Access email, matched to their tracker account. Seats, invites and the play log store that key, never an email directly, so another sign-in (Discord) can map to the same person later. The local dev server (no Access) names people with a dev-only `?as=<name>` and its own seat token, never the static gui player | locked (Matt: friends on mtg-tracker now, Discord far future) |
| D-M4 | A table in use refuses newcomers with a clear message naming whose table it is; it never queues silently | locked |
| D-M5 | Tables seat 4 by default; seat count is configurable; curated AIs fill the seats no human takes | locked (Matt) |
| D-M6 | A disconnected player pauses the game for everyone (M11.4); nothing is decided for them. A table with no human connected for 10 minutes ends with no winner and frees the server | locked (Matt) |
| D-M7 | Invites come from the tracker's people list. Friends must also be in the Cloudflare Access policy to reach `/play` | locked (Matt) |

## Milestones

| ID | Milestone | Exit criteria | Status |
|---|---|---|---|
| M11.1 | **Seats and invites** | The host sets up a table with 4 seats, invites a friend from the tracker people list, and the friend takes a seat and picks a deck. The other seats get AIs and the match starts. `MatchHost` keeps a seat list (person, socket, token, deck, ready) instead of one owner. Protocol: `table` (host, seats, decks chosen, ready), `invite`, `takeSeat`, `ready`, `setSeat` (host); documented in PROTOCOL.md. Spike first: how the page reads the people list from the tracker (an existing `/api/v1` endpoint, or a small new one in mtg-tracker) | todo |
| M11.2 | **Several humans in one match** | Two browsers (two identities) play a pod to the end. Each sees only their own hand. The headline names who we're waiting on. A player who is out can watch. The game shows in both histories. `tools/smoke.mjs --clients 2` covers it | todo |
| M11.3 | **Disconnects pause the game** | When a human's socket drops, every player sees "Paused: waiting for X to reconnect". The game stops: the AIs don't act, and no one can act on the stack meanwhile. Reconnecting resumes with the full state (`onConnect` already re-sends prompt, buttons and ask). The host can end the game for everyone. After 10 minutes with no human connected the game ends with no winner and the table frees (D-M6). Spike first: where to hold the game thread so the AIs stop too (the engine only parks when it asks a human something) | todo |
| M11.4 | **Capacity** | Measure one pod's CPU and RAM (the bench stack can) and give the `forge-web` container `cpus:` and memory limits that leave headroom for the host's other servers | todo |
| M11.5 | **Replicas** (deferred) | More tables at once: a front door owns the landing page, the table list and invites, and routes `/play/t/<id>` and its `/ws` to the game server hosting that table. Start with a fixed pool in compose (`forge-game-1..n`, each with limits) filled in order; starting servers on demand needs the Docker socket (root on the host), so it would be a small separate controller, and only if the pool runs out | deferred (Matt) |
| M12 | **Less waiting** (later) | Ordered by leverage: 1) no priority prompt when you can't do anything (the engine already sends `playable`; trade-off: an instant pass shows you have no tricks); 2) phase stops and auto-yield; 3) a per-decision timer with a time bank: on expiry, pass priority, and mandatory choices take a defined default; 4) AI think time, already capped at 5 s. Needs M11.2 | later |

## Risks

- **One table for everyone.** Until M11.5, while friends play, nobody else can play on the server;
  they see whose table it is.
- **A parked game thread.** A human who never answers parks the game thread on `awaitInput`
  indefinitely. M11.3 handles disconnects; M12's timer handles slow players.
- **CPU.** AI is the cost, and a 4-player pod with three AIs is the busiest case. M11.4 limits
  the container.
- **Server restarts end games.** Games in flight are lost on a deploy. Later: `-state` snapshots
  at turn boundaries could resume them. For now, deploys warn players first.

## Questions

| ID | Question | Options and current lean | Blocks |
|---|---|---|---|
| Q-M1 | Who can join? | Resolved by D-M7: friends on the tracker, who are also in the Access policy | |
| Q-M2 | Empty seats | Resolved by D-M5: curated AIs, 4 seats by default | |
| Q-M3 | A player disconnects | Resolved by D-M6: pause; 10 minutes with nobody connected ends the game | |
| Q-M4 | Several tables | Resolved by D-M1: one per server; replicas later (M11.5) | |
| Q-M5 | Spectators | Not needed for now; a player who is out can watch (M11.2) | — |
| Q-M6 | Table chat or emotes | Not needed for now | — |
