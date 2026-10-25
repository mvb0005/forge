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
| `src/main/java/forge/web/` | Server: `WebMain` (startup), `WebServer` (HTTP + WebSocket), `MatchHost` (lobby, starting matches), `WebGuiGame` (the engine's GUI interface: state sync, prompts, asks), `ViewProjector` (engine views → DTOs) |
| `src/main/java/forge/web/assist/` | Engine-computed help for the UI (`AssistProducer`) |
| `ui/src/` | React app: `protocol.ts` (types), `store.ts` (state), `net.ts` (socket) |
| `ui/src/table/` | Card layer contract and the peek (hover) provider registry |
| `ui/src/board/` | Battlefield, hand, seats, stack |
| `ui/src/shell/` | Lobby, prompt bar, dialogs |
| `tools/smoke.mjs` | Plays a whole game automatically against a running server |

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

Dev pages without a server: `/?preview` (board fixtures) and `/?dialogs` (every dialog).
