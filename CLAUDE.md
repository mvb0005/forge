# CLAUDE.md

Matt's fork of Forge (the MTG rules engine). Forge's own code is upstream's. The fork's work is
`forge-gui-web/`, a web table (Java WebSocket server plus React UI) that mtg-tracker and a Discord Activity
host. Start with `forge-gui-web/README.md` (layout, build, run, test), then `docs/PLAN.md`,
`docs/DESIGN.md`, `docs/MULTIPLAYER.md` and `PROTOCOL.md` there.

## Build and test (Git Bash on Windows)

- Jar: `JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.14.7-hotspot" /c/tools/apache-maven-3.9.9/bin/mvn -q -o -pl forge-gui-web -am package -DskipTests`
  (from the repo root). There's no Maven on PATH. A running server locks the jar on Windows, so run a
  copy of it.
- UI: `cd forge-gui-web/ui && npx tsc -p tsconfig.app.json --noEmit && npx vitest run && npm run build`
- Game tests: start a local server, then `node tools/smoke.mjs` and `node tools/passahead.mjs [--three]`
  (each takes `--port` and `--control-port`). Use Windows node: WSL's node has no WebSocket.
- Rules stay in the engine: the UI only displays what the server computes.

## Ship

Use the `deploy` skill (`forge-gui-web/deploy/ship.sh`): build, UI tests, deploy to minikube, then wait
for the spare table. It prints the rollback.

## Branches

- `master` is the main line, and what ships. Do feature work on a branch off `master`.
- To land a branch, rebuild it on `master` as a series of small commits, each one reasonable change that
  makes sense at a glance (they don't each have to build). Then fast-forward `master` and push. Never
  force-push `master`.
- `master` started as a snapshot of upstream Card-Forge. Bring upstream changes in by merging into
  `master`.
