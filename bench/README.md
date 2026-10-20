# Forge benchmark stack

Headless AI-vs-AI games in Docker, with traces and metrics in Grafana.

- **forge-sim**: the desktop jar in sim mode, in a loop. It plays every 4-player Commander pod in `matchups.txt` from turn 1, then every saved board in `scenarios.txt`. The OpenTelemetry Java agent exports the engine's `@WithSpan` markers and SimulateMatch's game metrics.
- **lgtm** (`grafana/otel-lgtm`): OTel collector, Prometheus, Tempo and Grafana. `lgtm/otelcol-config.yaml` turns every span into call-count and latency metrics before anything is sampled. `lgtm/tempo-config.yaml` sets trace retention.

## Use

```bash
./bench.sh up my-change     # build jar + image, start everything; Grafana at http://localhost:3000 (admin/admin)
./bench.sh compare [ref] [my-change]   # A/B: current code vs git ref (default HEAD), one sim each on the same seeds
./bench.sh logs             # sim output
./bench.sh down             # stop; collected data is kept
./bench.sh backup [dir]     # copy all collected data to dir (default ~/forge-bench-backups)
```

Both containers restart on their own (`restart: unless-stopped`), so the loop keeps going overnight and after Docker Desktop restarts. It doesn't run while Windows is asleep.

`bench.sh` needs `mvn` on PATH (or `MVN=/path/to/mvn`) and JDK 17. Each `up` is labelled `<VERSION>-<build#>-<change>`, e.g. `v1.0.0-3-cache-combat-predictions`. That label is the Version filter in Grafana. The exact code is kept as `forge.commit` (`<commit>[-dirty-<diff hash>]`). Bump `VERSION` by hand for milestones.

Run variables: defaults are in `.env`, and any of them can be overridden in the environment of `bench.sh` (see `docker-compose.yml`). They are `SIM_REPLICAS` (8 parallel sims), `SIM_CPUS` per sim (1.5), `JAVA_OPTS` (-Xmx2g), `GAMES_PER_RUN` (3), `GAME_TIMEOUT` seconds (1800), `ROUNDS` (0 = forever) and `SEED`.

`compare` builds `ref` in a git worktree at `bench/.baseline` and runs it next to the current code, one sim each with the same `SEED`. They're labelled `<VERSION>-<build#>-<change>` and `<VERSION>-<build#>-baseline`; pick both in the Version filter. Both play the same games until an AI decision hits its 5 s cap; after that their games differ, so compare totals over many games, not single games. `up` and `down` stop the baseline.

Without `SEED`, each replica starts from a random seed and logs the seed of every pod it plays (`round N seed S: ...`). To replay one of those runs: `SEED=S SIM_REPLICAS=1 ROUNDS=1 ./bench.sh up`. Replicas share the CPU, and the AI's time cap is wall-clock, so use `SIM_REPLICAS=1` when comparing timings between versions.

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
- **Sampling:** Tempo stores every trace with a span of 250 ms or more, plus 5% of the rest (`lgtm/otelcol-config.yaml`). Span metrics are computed before sampling, so counts and latencies cover every call. Exemplar links to unsampled fast calls won't open.
- **Retention:** metrics 1 year (`--storage.tsdb.retention.time`), traces 14 days (Tempo's default block retention). Metrics are small (MBs per day). Traces are about 100 MB per sim-hour before sampling.
- The dashboards themselves are files in `grafana/dashboards`, not data.

## Saved boards

`sim -dump <turn> <dir>` writes the board at main phase 1 of that turn as a GameState file. The desktop dev mode's "Dump Game State" writes the same format. Put the file in `states/` and its name in `scenarios.txt`, and every game of that scenario starts from that board. `sim -state <file> -dump 0 <dir>` writes the board right after loading, so you can diff it against the file.

Limits: 4-player states can't start in the declare attackers or declare blockers steps. A dump only includes players still in the game. A seed replays a game exactly unless an AI decision hits the 5 s cap, because the cap is wall-clock time.
