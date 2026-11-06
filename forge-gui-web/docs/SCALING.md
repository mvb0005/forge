# Scaling: how many tables, and what one costs

Measured 2026-11-06 on the minikube node, with build `forge-web:6813d418541`. The node is WSL2 on an i9-11900K:
8 cores and 16 threads. The host has 128 GB of RAM, and WSL gets its default half, 62 GiB.

## Method

Each test pod in namespace `forge-scale` held two containers:
- the real table image;
- a `node:22-alpine` driver running `tools/smoke.mjs` against `127.0.0.1`.

The driver plays one human seat instantly, so the AIs run flat out: 4-player Commander, random precons. CPU,
peak memory and the heap after each GC are read from the table container's own cgroup and from a GC log
(`-Xlog:gc`). This is the worst case for CPU. In a real game the table mostly waits for people.

## Results

| CPU / memory limit / -Xmx | Turns in 180 s | Peak RSS | Largest heap after GC | Notes |
|---|---|---|---|---|
| 2 / 4 GiB / 3 GB (today's template) | 37 | 1.19 GiB | 671 MB | the heap grows into whatever it's given |
| 1 / 1.5 GiB / 1 GB | 30 | 833 MiB | 414 MB | |
| 0.5 / 1.5 GiB / 1 GB | 21 | 691 MiB | 328 MB | slower, still fine |
| 1 / 1 GiB / 640 MB | 35 | 896 MiB | 590 MB | |
| 1 / 768 MiB / 448 MB | 39 | 663 MiB | 433 MB | |

Turn counts vary with the random decks, so read them roughly.

- **Idle spare:** 816 MiB RSS with -Xmx3g, mostly the card database and the JVM. Startup costs about 20
  CPU-seconds.
- **CPU per game turn** (one player's turn, the AIs thinking at full speed): about 6 CPU-seconds.
- **Long game,** to the end at 48 turns: about 310 MB of heap still live after a full GC.
  - 448 MB of heap needed 19 full GCs from allocation failures (pauses up to 0.7 s).
  - 640 MB needed 8.
  - Under a 1-CPU limit the JVM picks SerialGC, which is why there are full pauses at all.
- **16 tables at full speed together** (1 CPU each):
  - the node was 90% busy;
  - each game ran at about 60% of its solo speed (17 to 26 turns in 180 s, against about 33 alone);
  - memory went up about 10 GiB, so roughly 640 MiB a table at -Xmx640m.

## How many tables fit here

**Memory is the limit, not CPU.**
- **CPU:** a real game is people thinking. About 50 turns over an hour or two, at about 6 CPU-seconds a turn,
  averages roughly 0.05 to 0.1 of a core. Bursts (an AI turn) take a few seconds of one core.
- **Memory:** at -Xmx768m a table is about 1.05 GiB.
- **The node:** at idle it already uses about 16 GiB (minikube, the tracker, other WSL containers). That leaves
  about 46 GiB for tables.

| | Tables |
|---|---|
| This node as it is (62 GiB WSL) | **about 40** at -Xmx768m (about 50 at -Xmx640m) |
| WSL given 100 GiB of the 128 | about 75 |
| All-AI games at full speed (CPU-bound) | about 16 before every game slows |

**What stops it first today is configuration, not hardware:**
1. **The tracker's `CAPACITY = 4`** (mtgtracker/play/tables.py): at most 4 games at once.
2. **The table template's requests: 500m CPU and 2 GiB memory.** The scheduler stops at about 28 pods on
   memory requests, though each pod uses about 1 GiB. The -Xmx3g heap also lets each table grow to about
   1.2 GiB for no gain.
3. **One warm spare.** The first game starts at once. Others started together wait about 15 to 20 s each
   for a new pod: 11 s to start Forge, plus scheduling.

## Outside the game

- **Router (nginx):** two connections per WebSocket and about 1 KB per state message. Thousands of sockets
  before it matters. Its 500m CPU limit is plenty.
- **Tracker:** one uvicorn process on SQLite, 256 MiB limit. It serves lobby polls and the play pages. Fine for
  dozens of tables; a lobby full of people polling is the heaviest thing it does.
- **Cloudflare tunnel:** traffic per table is tiny (state deltas, card images from the pics volume, cached by
  the browser).
- **Replays:** 40 to 100 KB a game on the tracker's 1 GiB volume, so about 10,000 games before it fills.
- **Dev pods** share the node and may use up to 4 CPUs each. Several agents compiling at once will slow live
  tables. Lower their limits or give them a lower PriorityClass.

## Recommended table size

- -Xmx768m;
- requests: 250m CPU and 1.1 GiB memory;
- limits: 2 CPUs (keeps G1 and fast AI turns) and 1.5 GiB memory;
- `CAPACITY` set from free memory (about 40 here);
- two warm spares when more than a few games run.

## JVM settings (A/B, 2026-11-06)

Same decks in every game (Reign of Dragons against Neyali, Galea and Pantlaza), two pods per setting, each
playing two games to the end, all with 2 CPUs:

| Setting | Turns per minute | Peak RSS | Young-GC pause p99 |
|---|---|---|---|
| -Xmx3g, 4 GiB limit (the old template) | about 8.3 | about 1.7 GiB | 84 to 103 ms |
| -Xmx768m -XX:+UseG1GC, 1.5 GiB limit | about 11.7 | about 1.08 GiB | 52 to 66 ms |
| the same plus -XX:+UseStringDeduplication | about 11.6 | about 1.1 GiB | 68 to 87 ms |

Full GCs come only from Forge's `System.gc()` as a game ends. The game speed differences are within the
noise of the AI's choices. The smaller heap is clearly no slower, and saves about 0.6 GiB a table. String
deduplication saves nothing measurable, so it's left out. Not used, by measurement:
- class-data sharing (no change to the 9.6 s start);
- `-XX:TieredStopAtLevel=1` (1 s faster start, but no C2 for long AI games).

The table template uses -Xmx768m -XX:+UseG1GC, with requests of 250m CPU and 1200 MiB, and limits of 2 CPUs
and 1536 MiB.

## Cloud cost per table (forecast)

A table is about 1.1 GiB of memory and a little CPU, so the best value is memory-heavy shared-CPU machines. A
small fixed base on top: the tracker, the router and a spare, about 1.5 GiB, which fits on the same machine.

| Provider, machine | Price | Tables (after about 1.5 GiB base) | Per table per month (always on) | Per table-hour |
|---|---|---|---|---|
| Hetzner CPX42, 8 vCPU / 16 GB | about €69/mo | about 13 | about €5.3 | about €0.007 |
| Hetzner CPX32, 4 vCPU / 8 GB | about €35/mo | about 6 | about €5.9 | about €0.008 |
| GCP e2-standard-4, 4 vCPU / 16 GB | about $98/mo ($0.134/h) | about 13 | about $7.5 | about $0.010 |
| AWS m7a.large, 2 vCPU / 8 GiB | about $85/mo ($0.116/h) | about 6 | about $14 | about $0.019 |

Spot or preemptible machines are about 40 to 65% less, but a reclaimed machine ends its games. Committed use
(1 to 3 years) is 37 to 55% less on GCP. These prices are from aggregators as of November 2026 (Hetzner raised
prices twice in 2026). Check the providers' own pages before buying.

**The cheapest option is usage-based:** pay per table-hour and keep only the base running. For example, 4
tables for 3 hours a night is about 360 table-hours a month: about $4 on GCP, about €3 on Hetzner, plus the
base. Running the same machine always on is the per-month figure.
