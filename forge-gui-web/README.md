# forge-gui-web

A web frontend for Forge: a Java server that runs the engine and a React UI that talks to it over
one WebSocket.

- [docs/PLAN.md](docs/PLAN.md): what we're building, in what order, open questions, architecture
  rules and performance budgets.
- [docs/DESIGN.md](docs/DESIGN.md): how the table looks and behaves.
- [PROTOCOL.md](PROTOCOL.md): the wire contract between server and UI.

## Layout

| Path | What |
|---|---|
| `src/main/java/forge/web/` | Server. `WebMain`, `WebServer`, `MatchHost`, `WebGuiGame` (the engine's GUI interface), `ViewProjector` (views to DTOs), `BoardFacts` (facts the views don't carry, read at decision points) |
| `src/main/java/forge/web/assist/` | Engine-computed help (`AssistProducer`): combat outcomes, legal blockers, open mana |
| `ui/src/` | React app: `protocol.ts`, `store.ts`, `net.ts` |
| `ui/src/table/` | The one card layer: per-mode layouts and structural signatures |
| `ui/src/look/` | Visual language: tokens, card frame, type line, shields, mana ribbon, keyword rail |
| `ui/src/board/` | Table, seats, combat lanes, zones. Cards are drawn only by the card layer |
| `ui/src/shell/` | Lobby, action plate, dialogs |
| `ui/src/popover/` | Hover peek and pinned inspect |
| `ui/src/bench/` | Performance page for the budgets in PLAN.md |
| `tools/smoke.mjs` | Plays a game against a running server and checks the wire |

## Dev pages

`/?preview` and `/?bench` work against the built UI. The others are dev-server only.

| URL | What |
|---|---|
| `/?preview` | Table from a fixture. `?preview=pod` picks one |
| `/?bench=pod` or `/?bench=commander` | Client performance budgets. Measure a production build, window focused |
| `/?look` | Every look component. `/?look=live&scene=main` drives the real table from a scene |
| `/?dialogs` | Every dialog |
| `/?peek` | The popover system |

## Build

Maven needs `-am` (the `${revision}` version only resolves with the upstream modules):

```
mvn -pl forge-gui-web -am package -DskipTests
cd forge-gui-web/ui && npm install && npm run build
```

## Run

The server must be started from `forge-gui` so it finds `res/`. Point `--pics` at an existing Forge
image cache; it's only read, never written.

```
cd forge-gui
java -jar ../forge-gui-web/target/forge-gui-web-<version>-jar-with-dependencies.jar --port 7777 --pics <Forge cache>/pics
```

The game server only runs games (docs/MULTIPLAYER.md): mtg-tracker's play module starts each match
through the control API (port 7790, PROTOCOL.md "Control API") and sends each player to the table
with a seat ticket. Without the tracker, start one yourself; it prints each seat's link:

```
node forge-gui-web/tools/start.mjs                                   # Commander, random precons, 3 AIs
node forge-gui-web/tools/start.mjs --deck reign-of-dragons.txt --curated neyali,jeleva
node forge-gui-web/tools/start.mjs --format constructed --deck random:RG
node forge-gui-web/tools/start.mjs --state token-pod-turn12.txt
```

The table is at http://127.0.0.1:7777/play/table/<match id>/?ticket=... (the server also answers at `/`). For UI
development, run `npm run dev` in `ui/` (port 5173, proxies `/ws` and `/img` to the server;
`FORGE=host:port` overrides it) and pass `--ui http://127.0.0.1:5173/` to `start.mjs`.

The players' port admits only seat tickets. The control API listens where the players' port does
(`--control-host` to change it) and refuses any address but loopback without `FORGE_CONTROL_SECRET`;
with it, every call carries `Authorization: Bearer <secret>`. `tools/start.mjs` and `tools/smoke.mjs`
send it from the environment.

It runs on the same minikube cluster as mtg-tracker (in WSL), in namespace `forge`, with card data
from `forge-gui/res`, a data volume for its profile, and a read-only volume of card images copied
from the desktop's pics cache. The `forge-web` Service is the players' side; `forge-control` is the
control API, for the tracker only. mtg-tracker's Cloudflare Tunnel connector routes
`^/play/table(/|$)` to `http://forge-web.forge.svc.cluster.local:80`; the rest of the hostname,
`/play` included, is the tracker. From WSL, after building the jar and the UI (`up` tags each build
uniquely and builds with Windows' `docker.exe` when the checkout is on the Windows drive):

```
deploy/minikube.sh secret             # once: the control API's shared secret (mtg-tracker gets the same value)
deploy/minikube.sh up                 # build the image, load it into minikube, roll out once a running game ends
deploy/minikube.sh up --now           # the same, ending a running game
deploy/minikube.sh load-pics          # refresh the card images from the desktop cache
deploy/minikube.sh forward            # http://127.0.0.1:7781/play/table/
deploy/minikube.sh logs
```

The server uses the normal Forge user profile (preferences, logs). To keep a development server
away from your real profile, start it with `APPDATA` and `LOCALAPPDATA` pointing at a scratch
folder.

## Test

```
cd forge-gui-web/ui && npx tsc -p tsconfig.app.json --noEmit && npm run test
node forge-gui-web/tools/smoke.mjs                      # a full game, random decks, started through the control API
node forge-gui-web/tools/smoke.mjs --state token-pod-turn12.txt
node forge-gui-web/tools/smoke.mjs --format commander --tracker-deck reign-of-dragons.txt --curated neyali,jeleva
node forge-gui-web/tools/lifecycle.mjs                  # the control API: seats, tickets, 409, ending a match
```

Tracker decklist exports for `--tracker-deck` live in `tools/decks/` (`node tools/smoke.mjs --format commander
--tracker-deck reign-of-dragons.txt --curated neyali,jeleva`). Saved boards for the smoke test live in `tools/states/`, including `fields-badges.txt` (base P/T,
keyword labels, colour identity).
