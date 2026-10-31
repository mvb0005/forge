# Forge web UI: multiplayer plan

Milestone M11 in PLAN.md. Same conventions: milestones end playable, exit criteria are the
definition of done, D- are decisions, Q- are open questions.

## Goal

Friends play a Commander pod together, each with a deck from their own tracker account. The players
are people Matt has added to mtg-tracker. A table seats 4 by default (configurable), with curated
AIs in the seats no human takes. A game server hosts exactly one table (D-M1). More tables later
means more game servers (M11.5, deferred). Waiting on other people is cut down later (M12), not
first.

Far future: the same table as a Discord game (a Discord Activity: the web client in Discord's
iframe, people known by their Discord id), and perhaps a hosted cluster instead of minikube. Nothing
here builds either, but people are tracker person ids (D-M3), so another sign-in can map to them.

## The split (D-M8)

**mtg-tracker connects people; the game server runs games.** Everything about who plays lives in a
distinct module of mtg-tracker, `mtgtracker/play/`:

- people and usernames (`/api/v1/people`);
- the play page: pick a deck, pick AI opponents, invite friends;
- tables: seats, decks chosen, ready, start, rematch;
- seat tickets, and handing a match to the game server;
- game history, written from the game server's results.

The game server (`forge-gui-web`) keeps only:

- a control API: start a match from a spec, report status, end a match;
- the table page (the React client) and its WebSocket, admitting a socket by its seat ticket;
- everything inside a match: rules, per-viewer views, assists, "waiting on", pause on disconnect.

It has no lobby, no decks list, no identity lookups and no play log of its own.

```
browser ── /play/... (tracker module: play page, tables, invites) ──> mtg-tracker
   │                                                                     │ control API (in-cluster,
   │                                                                     │ shared secret)
   └── /play/table/?ticket=… + its WebSocket ──> game server <───────────┘
                                                     │ results ──> tracker (in-cluster)
```

**The handoff.**
1. The host makes a table on the tracker and invites friends. Each person picks a deck there. The
   tracker reads decks from its own database, so the browser no longer carries a decklist.
2. When everyone is ready, the tracker POSTs a match spec to the game server: format, and per seat
   either a human (person id, display name, decklist text, seat ticket) or an AI (opponent id).
3. Each human is sent to the table page with their ticket. The game server admits a socket by its
   ticket and binds the seat to it; reconnecting with the same ticket takes the seat back.
4. Status (playing, paused, finished) and the result go back to the tracker, which keeps the game
   history and shows it on the play page.

**Trust.**
- Cloudflare Access still gates the public hostname, so only people Matt allows reach either app.
- The control API is in-cluster only: a separate port on a separate Service that the tunnel never
  routes to, and a shared secret on every call.
- Seat tickets are random, single-seat bearer tokens that the tracker makes per match. The game
  server checks nothing else about who you are.

**Routing.** The tunnel keeps one hostname. `/play` and the play module's pages go to the tracker.
The table page and its socket (`/play/table/…`, `/play/ws`, card images) go to the game server.

## Where we are

- **The game server is on minikube.** It runs in namespace `forge` beside the tracker
  (`deploy/minikube.sh`). The node has 16 CPUs and 64 GB; the pod asks for 1 CPU and 2 GiB and may
  use 4 CPUs and 4 GiB. It reaches the tracker in-cluster. The tunnel's `/play` route still points
  at the old Docker server until Matt switches it (M11.0).
- **The engine already handles several humans.** `HostedMatch.startMatch` takes a map from
  `RegisteredPlayer` to `IGuiGame`. Forge's own network server gives each remote player a
  `RemoteClientGuiGame`. `AbstractGuiGame.mayView` hides cards per local player, so one
  `WebGuiGame` per human seat gets per-viewer hiding for free.
- **What moves out of the game server.**
  - The React landing page (`Lobby.tsx`), which already copies the tracker's look, is replaced by
    the play module's server-rendered pages.
  - `MatchHost`'s lobby, deck lists and `startMatch` become the control API.
  - `AccessIdentity`'s email-based seat and `PlayLog` go; history lives in the tracker.
  - `TrackerDeck` (decklist text to a Forge deck) stays: the spec still carries decklist text.
- **Single-human assumptions to remove.** `MatchHost` holds one channel, one seat token and one
  owner. The human is the static `GamePlayerUtil.getGuiPlayer()` when there's no Access. Match end
  disposes the session and sends the lobby. Assists, notices and reveals assume the only human is
  the viewer.
- **Development without the tracker.** `tools/smoke.mjs`, saved boards and `?preview` must keep
  working. The smoke and saved boards start matches through the control API, as the tracker does.

## Decisions

| ID | Decision | Status |
|---|---|---|
| D-M1 | One table per game server. It keeps games sandboxed from each other (Forge has never run several matches in one JVM) and needs no table registry in the game server. More tables means more servers (M11.5) | locked (Matt) |
| D-M2 | Rules stay in the engine. "Waiting on", pause and seat state inside a match come from the game server; the client displays them | locked |
| D-M3 | A person is their tracker person id. The tracker knows who is signed in (Access, as today) and gains usernames: an optional, unique handle set on the profile, shown in invites. `/api/v1/people` lists id, username and name, never emails | locked (Matt) |
| D-M4 | A game server that is busy refuses a new match, and the tracker tells the host whose table is running; nothing queues silently | locked |
| D-M5 | Tables seat 4 by default; seat count is configurable; curated AIs fill the seats no human takes | locked (Matt) |
| D-M6 | A disconnected player pauses the game for everyone (M11.3); nothing is decided for them. A match with no human connected for 10 minutes ends with no winner and frees the server | locked (Matt) |
| D-M7 | Invites come from the tracker's people list. Friends must also be in the Cloudflare Access policy | locked (Matt) |
| D-M8 | All connecting logic (people, tables, invites, seats, decks, history) lives in mtg-tracker as a distinct module, `mtgtracker/play/`: its own routers, templates, services and tables (`play_*`, in their own migrations), touching the rest of the tracker only through users and deck exports. The game server only runs games | locked (Matt) |

## Milestones

| ID | Milestone | Exit criteria | Status |
|---|---|---|---|
| M11.0 | **Move to minikube** | The game server runs in namespace `forge` beside the tracker, `/play` routes to it through the tracker's tunnel, and it reaches the tracker in-cluster | doing (pod up and checked; switching the tunnel's route and retiring the Docker service remain) |
| M11.1 | **The game server's control API** | The game server starts a match from a spec (POST, shared secret, separate in-cluster port) with any mix of human and AI seats, admits each human socket by its seat ticket, reports status, and ends a match on request. Its lobby, deck lists, email seat and play log are gone. `tools/smoke.mjs` starts its games through the API. PROTOCOL.md documents the API and the ticket handshake | todo |
| M11.2 | **The play module in mtg-tracker, solo** | `mtgtracker/play/`: usernames, `/api/v1/people`, the play page in the tracker's own templates (deck, AI opponents), a table with one human, the handoff to the game server, and game history from its results. Goldfishing works as it does today, through the tracker. Tracker tests cover the module with the game server faked | todo |
| M11.3 | **Invites and several humans** | The host invites a friend from the people list; the friend sees the invite on the play page, picks a deck and readies. Two browsers (two identities) play a pod to the end. Each sees only their own hand. The headline names who we're waiting on. A player who is out can watch. The game shows in both histories. `tools/smoke.mjs --clients 2` covers the game server's side | todo |
| M11.4 | **Disconnects pause the game** | When a human's socket drops, every player sees "Paused: waiting for X to reconnect". The game stops: the AIs don't act, and no one can act on the stack meanwhile. Reconnecting resumes with the full state (`onConnect` already re-sends prompt, buttons and ask). The host can end the game for everyone. After 10 minutes with no human connected the game ends with no winner and the server frees (D-M6). Spike first: where to hold the game thread so the AIs stop too (the engine only parks when it asks a human something) | todo |
| M11.5 | **Capacity** | Measure one pod's CPU and RAM (the bench stack can) and tune the pod's requests and limits | todo |
| M11.6 | **Replicas** (deferred) | More tables at once: the play module creates a game server pod per table through the Kubernetes API (a service account allowed only to create and delete pods in `forge`) and sends each table's players to their pod. Later, the same manifests could move to a hosted cluster | deferred (Matt) |
| M12 | **Less waiting** (later) | Ordered by leverage: 1) no priority prompt when you can't do anything (the engine already sends `playable`; trade-off: an instant pass shows you have no tricks); 2) phase stops and auto-yield; 3) a per-decision timer with a time bank: on expiry, pass priority, and mandatory choices take a defined default; 4) AI think time, already capped at 5 s. Needs M11.3 | later |

## Risks

- **One table for everyone.** Until M11.6, while friends play, nobody else can play; the tracker
  shows whose table is running.
- **Two repos move together.** The control API is the contract; version it (a `version` in the
  spec) and keep the tracker's fake game server in step with PROTOCOL.md.
- **A parked game thread.** A human who never answers parks the game thread on `awaitInput`
  indefinitely. M11.4 handles disconnects; M12's timer handles slow players.
- **CPU.** AI is the cost, and a 4-player pod with three AIs is the busiest case (M11.5).
- **Server restarts end games.** Games in flight are lost on a deploy. Later: `-state` snapshots
  at turn boundaries could resume them. For now, deploys warn players first.

## Questions

| ID | Question | Options and current lean | Blocks |
|---|---|---|---|
| Q-M5 | Spectators | Not needed for now; a player who is out can watch (M11.3) | — |
| Q-M6 | Table chat or emotes | Not needed for now | — |
| Q-M9 | Moving the existing play history | Lean: import `games.json` into the play module once, then drop it from the game server | M11.2 |
| Q-M10 | The play page's look | The tracker's own templates and CSS (no JS build, its rule). Lean: yes; the React landing page goes | M11.2 |
