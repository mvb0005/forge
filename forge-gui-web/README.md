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

Open http://127.0.0.1:7777. For UI development, run `npm run dev` in `ui/` (port 5173, proxies
`/ws` and `/img` to the server).

The server uses the normal Forge user profile (preferences, logs). To keep a development server
away from your real profile, start it with `APPDATA` and `LOCALAPPDATA` pointing at a scratch
folder.

## Test

```
cd forge-gui-web/ui && npx tsc -p tsconfig.app.json --noEmit && npm run test
node forge-gui-web/tools/smoke.mjs                      # a full game, random decks
node forge-gui-web/tools/smoke.mjs --state token-pod-turn12.txt
```

Saved boards for the smoke test live in `tools/states/`, including `fields-badges.txt` (base P/T,
keyword labels, colour identity).
