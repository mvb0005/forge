# Forge benchmark stack

Headless AI-vs-AI games in Docker, with traces and metrics in Grafana.

- **forge-sim**: the desktop jar in sim mode, in a loop. It plays every 4-player Commander pod in `matchups.txt` from turn 1, then every saved board in `scenarios.txt`. The OpenTelemetry Java agent exports the engine's `@WithSpan` markers and SimulateMatch's game metrics.
- **lgtm** (`grafana/otel-lgtm`): OTel collector, Prometheus, Tempo and Grafana. `lgtm/otelcol-config.yaml` turns every span into call-count and latency metrics before anything is sampled. `lgtm/tempo-config.yaml` sets trace retention.

## Use

```bash
./bench.sh up my-change     # build jar + image, start everything; Grafana at http://localhost:3000 (admin/admin)
./bench.sh logs             # sim output
./bench.sh down             # stop; collected data is kept
./bench.sh backup [dir]     # copy all collected data to dir (default ~/forge-bench-backups)
```

Both containers restart on their own (`restart: unless-stopped`), so the loop keeps going overnight and after Docker Desktop restarts. It doesn't run while Windows is asleep.

`bench.sh` needs `mvn` on PATH (or `MVN=/path/to/mvn`) and JDK 17. Each `up` is labelled `<VERSION>-<build#>-<change>`, e.g. `v1.0.0-3-cache-combat-predictions`. That label is the Version filter in Grafana. The exact code is kept as `forge.commit` (`<commit>[-dirty-<diff hash>]`). Bump `VERSION` by hand for milestones.

Run variables, set in the environment of `bench.sh` (see `docker-compose.yml`): `GAMES_PER_RUN` (3), `GAME_TIMEOUT` seconds (1800), `SEED` (1), `ROUNDS` (0 = forever), `SIM_CPUS` (4), `JAVA_OPTS` (-Xmx3g).

## Dashboards (Forge folder)

- **Forge sim overview**: games, duration, turns, seconds per turn, timeouts and errors. Also wins by commander and the winner of each turn order, all filterable by version, scenario, pod and turn order.
- **Forge engine hot paths**: calls, latency and time share per span; static passes and state checks per priority step; AI decision timeouts and where the AI was stuck; slow AI decisions linked to their traces.

The dashboards are generated: edit `grafana/gen_dashboards.py`, then run
`python grafana/gen_dashboards.py grafana/dashboards` and reload with `curl -u admin:admin -X POST localhost:3000/api/admin/provisioning/dashboards/reload`.
`python grafana/check_dashboards.py 2h` runs every panel query through Grafana and flags any that error or come back empty.

## Data

Everything Grafana shows is in the Docker volume `forge-bench-data`, mounted at `/data` in the lgtm container: Prometheus metrics, Tempo traces and Grafana's own state.
- **Kept when** containers are removed, rebuilt or upgraded, including `docker compose down -v`. The volume is declared `external`, so compose never deletes it.
- **Lost when** someone runs `docker volume rm forge-bench-data` or `docker volume prune -a`, or resets or uninstalls Docker Desktop. Run `./bench.sh backup` for a copy outside Docker. To restore, untar the copy into a new `forge-bench-data` volume.
- **Retention:** metrics 1 year (`--storage.tsdb.retention.time`), traces 14 days (`lgtm/tempo-config.yaml`). Metrics are small (MBs per day). Traces are about 1 GB per 12 hours of sims.
- The dashboards themselves are files in `grafana/dashboards`, not data.

## Saved boards

`sim -dump <turn> <dir>` writes the board at main phase 1 of that turn as a GameState file. The desktop dev mode's "Dump Game State" writes the same format. Put the file in `states/` and its name in `scenarios.txt`, and every game of that scenario starts from that board. `sim -state <file> -dump 0 <dir>` writes the board right after loading, so you can diff it against the file.

Limits: 4-player states can't start in the declare attackers or declare blockers steps. A dump only includes players still in the game. A seed replays a game exactly unless an AI decision hits the 5 s cap, because the cap is wall-clock time.
