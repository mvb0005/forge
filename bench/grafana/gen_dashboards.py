import json, os, sys

# Writes the Forge Grafana dashboards. Usage: python gen_dashboards.py <output dir>  (bench/grafana/dashboards)
# then reload: curl -u admin:admin -X POST localhost:3000/api/admin/provisioning/dashboards/reload
OUT = sys.argv[1]
PROM = {"type": "prometheus", "uid": "prometheus"}
TEMPO = {"type": "tempo", "uid": "tempo"}

_id = [0]
def nid():
    _id[0] += 1
    return _id[0]

def target(expr, legend="", instant=False, ref="A", exemplar=False, fmt=None):
    t = {"datasource": PROM, "expr": expr, "legendFormat": legend or "__auto", "refId": ref}
    if instant:
        t["instant"] = True
        t["range"] = False
    if exemplar:
        t["exemplar"] = True
    if fmt:
        t["format"] = fmt
    return t

def stat(title, expr, x, y, w=4, h=4, unit="none", decimals=None, desc="", thresholds=None):
    p = {"id": nid(), "type": "stat", "title": title, "description": desc, "datasource": PROM,
         "gridPos": {"x": x, "y": y, "w": w, "h": h},
         "targets": [target(expr, instant=True)],
         "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                     "colorMode": "value", "graphMode": "none", "textMode": "value"},
         "fieldConfig": {"defaults": {"unit": unit, "color": {"mode": "thresholds"},
                                      "thresholds": thresholds or {"mode": "absolute", "steps": [{"color": "text", "value": None}]}},
                         "overrides": []}}
    if decimals is not None:
        p["fieldConfig"]["defaults"]["decimals"] = decimals
    return p

def ts(title, targets, x, y, w=12, h=8, unit="none", desc="", log=False, stack=False, bars=False):
    custom = {"drawStyle": "bars" if bars else "line", "lineWidth": 1, "fillOpacity": 60 if bars else (0 if log else 8),
              "showPoints": "never", "spanNulls": True}
    if log:
        custom["scaleDistribution"] = {"type": "log", "log": 10}
    if stack:
        custom["stacking"] = {"mode": "normal", "group": "A"}
    return {"id": nid(), "type": "timeseries", "title": title, "description": desc, "datasource": PROM,
            "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": targets,
            "fieldConfig": {"defaults": {"unit": unit, "custom": custom}, "overrides": []},
            "options": {"legend": {"displayMode": "table", "placement": "bottom", "calcs": ["mean", "max"]},
                        "tooltip": {"mode": "multi", "sort": "desc"}}}

def row(title, y):
    return {"id": nid(), "type": "row", "title": title, "collapsed": False, "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": []}

def table(title, targets, x, y, w, h, renames, units, desc="", sort=None):
    order = {k: i for i, k in enumerate(renames)}
    # units: column -> unit, "count" for whole numbers, or a dict of extra field properties
    overrides = []
    for name, unit in units.items():
        if unit == "count":
            props = [{"id": "decimals", "value": 0}]
        elif isinstance(unit, dict):
            props = [{"id": k, "value": v} for k, v in unit.items()]
        else:
            props = [{"id": "unit", "value": unit}]
        overrides.append({"matcher": {"id": "byName", "options": name}, "properties": props})
    p = {"id": nid(), "type": "table", "title": title, "description": desc, "datasource": PROM,
         "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": targets,
         "transformations": [{"id": "merge", "options": {}},
                             {"id": "organize", "options": {"excludeByName": {"Time": True}, "indexByName": order, "renameByName": renames}}],
         "fieldConfig": {"defaults": {"decimals": 2}, "overrides": overrides},
         "options": {"showHeader": True, "cellHeight": "sm"}}
    if sort:
        p["options"]["sortBy"] = [{"displayName": sort, "desc": True}]
    return p

def var_query(name, label, query, include_all=True, multi=True):
    return {"name": name, "label": label, "type": "query", "datasource": PROM,
            "query": {"query": query, "refId": "v"}, "definition": query, "refresh": 2,
            "includeAll": include_all, "multi": multi, "allValue": ".*",
            "current": {"selected": True, "text": ["All"], "value": ["$__all"]}, "sort": 1}

def dashboard(uid, title, desc, panels, variables):
    return {"uid": uid, "title": title, "description": desc, "tags": ["forge"], "editable": True,
            "schemaVersion": 39, "time": {"from": "now-1h", "to": "now"}, "refresh": "30s",
            "templating": {"list": variables}, "panels": panels, "annotations": {"list": []}}

# ---------------------------------------------------------------- overview
G = 'service_version=~"$version",forge_scenario=~"$scenario",forge_pod=~"$pod",forge_matchup=~"$matchup"'
cnt = f'forge_game_duration_seconds_count{{{G}}}'
bkt = f'forge_game_duration_seconds_bucket{{{G}}}'
dsum = f'forge_game_duration_seconds_sum{{{G}}}'
tsum = f'forge_game_turns_sum{{{G}}}'
tcnt = f'forge_game_turns_count{{{G}}}'
bad = f'forge_game_duration_seconds_count{{{G},forge_outcome=~"timeout|error"}}'
won = f'forge_game_duration_seconds_count{{{G},forge_outcome!~"timeout|error|draw"}}'
red = {"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}

p = []
p.append(stat("Games played", f'round(sum(increase({cnt}[$__range])))', 0, 0, decimals=0))
p.append(stat("Median game", f'histogram_quantile(0.5, sum by (le) (increase({bkt}[$__range])))', 4, 0, unit="s", decimals=1))
p.append(stat("p95 game", f'histogram_quantile(0.95, sum by (le) (increase({bkt}[$__range])))', 8, 0, unit="s", decimals=1))
p.append(stat("Avg turns per game", f'sum(increase({tsum}[$__range])) / sum(increase({tcnt}[$__range]))', 12, 0, decimals=1,
              desc="Every player's turn counts, so one round of a 4-player pod is 4 turns."))
p.append(stat("Seconds per turn", f'sum(increase({dsum}[$__range])) / sum(increase({tsum}[$__range]))', 16, 0, unit="s", decimals=2,
              desc="Game wall time divided by turns played. Less sensitive to how long games run than raw game duration."))
p.append(stat("Timeouts + errors", f'round(sum(increase({bad}[$__range]))) or vector(0)', 20, 0, decimals=0, thresholds=red,
              desc="Games stopped by the sim clock (GAME_TIMEOUT) or by an exception. Their durations still count in the other stats."))

p.append(row("Winners (whole time range)", 4))
p.append({"id": nid(), "type": "bargauge", "title": "Wins by commander", "datasource": PROM,
          "gridPos": {"x": 0, "y": 5, "w": 10, "h": 10},
          "targets": [target(f'sort_desc(round(sum by (forge_outcome) (increase({won}[$__range]))))', "{{forge_outcome}}", instant=True)],
          "options": {"orientation": "horizontal", "displayMode": "basic", "showUnfilled": True, "valueMode": "color",
                      "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}},
          "fieldConfig": {"defaults": {"decimals": 0, "min": 0, "color": {"mode": "fixed", "fixedColor": "green"}}, "overrides": []}})
p.append(table("Winner by turn order", [
    target(f'round(sum by (forge_matchup, forge_outcome) (increase({cnt}[$__range]))) > 0', instant=True, ref="A", fmt="table")],
    10, 5, 14, 10,
    {"forge_matchup": "Turn order", "forge_outcome": "Winner", "Value": "Games"},
    {"Games": "count", "Turn order": {"custom.width": 560}},
    desc="Each row is one seating of a pod, players listed in turn order (first player first), and who won it.", sort="Games"))

p.append(row("Over time", 15))
p.append(ts("Game duration by version", [
    target(f'histogram_quantile(0.5, sum by (le, service_version) (rate({bkt}[$__rate_interval])))', "p50 {{service_version}}", ref="A"),
    target(f'histogram_quantile(0.95, sum by (le, service_version) (rate({bkt}[$__rate_interval])))', "p95 {{service_version}}", ref="B")],
    0, 16, h=10, unit="s"))
p.append(ts("Seconds per turn by pod", [
    target(f'sum by (forge_pod) (rate({dsum}[$__rate_interval])) / sum by (forge_pod) (rate({tsum}[$__rate_interval]))', "{{forge_pod}}")],
    12, 16, h=10, unit="s"))
p.append(ts("Games per hour by outcome", [
    target(f'sum by (forge_outcome) (rate({cnt}[$__rate_interval])) * 3600', "{{forge_outcome}}")],
    0, 26, h=10, unit="none", stack=True, bars=True))
p.append(ts("Average turns per game by pod", [
    target(f'sum by (forge_pod) (rate({tsum}[$__rate_interval])) / sum by (forge_pod) (rate({tcnt}[$__rate_interval]))', "{{forge_pod}}")],
    12, 26, h=10))

p.append(row("By pod and version (whole time range)", 36))
by = "forge_pod, service_version"
p.append(table("Pods", [
    target(f'round(sum by ({by}) (increase({cnt}[$__range])))', instant=True, ref="A", fmt="table"),
    target(f'histogram_quantile(0.5, sum by (le, {by}) (increase({bkt}[$__range])))', instant=True, ref="B", fmt="table"),
    target(f'histogram_quantile(0.95, sum by (le, {by}) (increase({bkt}[$__range])))', instant=True, ref="C", fmt="table"),
    target(f'sum by ({by}) (increase({tsum}[$__range])) / sum by ({by}) (increase({tcnt}[$__range]))', instant=True, ref="D", fmt="table"),
    target(f'sum by ({by}) (increase({dsum}[$__range])) / sum by ({by}) (increase({tsum}[$__range]))', instant=True, ref="E", fmt="table"),
    target(f'round(sum by ({by}) (increase({bad}[$__range]))) or (0 * sum by ({by}) (increase({cnt}[$__range])))', instant=True, ref="F", fmt="table")],
    0, 37, 24, 8,
    {"forge_pod": "Pod", "service_version": "Version", "Value #A": "Games", "Value #B": "Median game",
     "Value #C": "p95 game", "Value #D": "Avg turns", "Value #E": "Sec per turn", "Value #F": "Timeouts + errors"},
    {"Median game": "s", "p95 game": "s", "Sec per turn": "s", "Games": "count", "Timeouts + errors": "count", "Pod": {"custom.width": 520}}))

p.append(row("JVM (sim containers)", 45))
J = 'service_name="forge-sim",service_version=~"$version"'
p.append(ts("Heap used", [target(f'sum by (service_version) (last_over_time(jvm_memory_used_bytes{{{J},jvm_memory_type="heap"}}[30s]))', "{{service_version}}")],
            0, 46, w=8, unit="bytes", desc="Heap of running sim JVMs (series that stopped reporting 30s ago are dropped)."))
p.append(ts("Time in GC", [target(f'sum by (service_version) (rate(jvm_gc_duration_seconds_sum{{{J}}}[$__rate_interval]))', "{{service_version}}")],
            8, 46, w=8, unit="percentunit", desc="Fraction of wall time spent in GC pauses."))
p.append(ts("CPU used", [target(f'sum by (service_version) (rate(jvm_cpu_time_seconds_total{{{J}}}[$__rate_interval]))', "{{service_version}}")],
            16, 46, w=8, unit="none", desc="CPU cores in use by the sim JVM (1 = one full core)."))

overview = dashboard("forge-sim-overview", "Forge sim overview",
                     "Seeded 4-player Commander AI games from bench/: game time, turns and winners per pod and build version.", p,
                     [var_query("version", "Version", 'label_values(forge_game_duration_seconds_count, service_version)'),
                      var_query("scenario", "Scenario", 'label_values(forge_game_duration_seconds_count{service_version=~"$version"}, forge_scenario)'),
                      var_query("pod", "Pod", 'label_values(forge_game_duration_seconds_count{service_version=~"$version"}, forge_pod)'),
                      var_query("matchup", "Turn order", 'label_values(forge_game_duration_seconds_count{service_version=~"$version",forge_pod=~"$pod"}, forge_matchup)')])

# ---------------------------------------------------------------- hot paths
_id[0] = 0
red = {"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}
S = 'service_name="forge-sim",service_version=~"$version"'
calls = lambda name: f'traces_span_metrics_calls_total{{{S},span_name="{name}"}}'
SP = f'{S},span_name=~"$span"'
c_all = f'traces_span_metrics_calls_total{{{SP}}}'
d_sum = f'traces_span_metrics_duration_milliseconds_sum{{{SP}}}'
d_cnt = f'traces_span_metrics_duration_milliseconds_count{{{SP}}}'
d_bkt = f'traces_span_metrics_duration_milliseconds_bucket{{{SP}}}'
step = 'PhaseHandler.mainLoopStep'

p = []
p.append(stat("Static passes per priority step",
              f'sum(increase({calls("GameAction.checkStaticAbilities")}[$__range])) / sum(increase({calls(step)}[$__range]))',
              0, 0, w=6, decimals=2,
              desc="GameAction.checkStaticAbilities calls per PhaseHandler.mainLoopStep. Each one clears and re-applies every continuous effect. A delta-based engine should push this toward the number of steps where something actually changed."))
p.append(stat("State checks per priority step",
              f'sum(increase({calls("GameAction.checkStateEffects")}[$__range])) / sum(increase({calls(step)}[$__range]))',
              6, 0, w=6, decimals=2, desc="GameAction.checkStateEffects calls per priority step. Each one runs up to 9 static passes."))
p.append(stat("AI spell choice p95",
              f'histogram_quantile(0.95, sum by (le) (increase(traces_span_metrics_duration_milliseconds_bucket{{{S},span_name="PlayerControllerAi.chooseSpellAbilityToPlay"}}[$__range])))',
              12, 0, w=6, unit="ms", decimals=1))
p.append(stat("AI attack decision p95",
              f'histogram_quantile(0.95, sum by (le) (increase(traces_span_metrics_duration_milliseconds_bucket{{{S},span_name="PlayerControllerAi.declareAttackers"}}[$__range])))',
              18, 0, w=6, unit="ms", decimals=1))

p.append(row("Per span", 4))
p.append(ts("Calls per second", [target(f'sum by (span_name) (rate({c_all}[$__rate_interval]))', "{{span_name}}")],
            0, 5, h=12, unit="none", log=True))
p.append(ts("Time spent per second (inclusive)", [target(f'sum by (span_name) (rate({d_sum}[$__rate_interval])) / 1000', "{{span_name}}")],
            12, 5, h=12, unit="none",
            desc="Seconds of wall time per second inside each span, children included: checkStaticAbilities time is also counted inside checkStateEffects and mainLoopStep. 1.0 = the sim thread is always in it."))
p.append(ts("p95 latency", [target(f'histogram_quantile(0.95, sum by (le, span_name) (rate({d_bkt}[$__rate_interval])))', "{{span_name}}", exemplar=True)],
            0, 17, h=12, unit="ms", log=True, desc="Exemplar dots link to the trace of a matching call."))
p.append(ts("Mean latency", [target(f'sum by (span_name) (rate({d_sum}[$__rate_interval])) / sum by (span_name) (rate({d_cnt}[$__rate_interval]))', "{{span_name}}")],
            12, 17, h=12, unit="ms", log=True))

p.append(row("Redundant work", 29))
p.append(ts("Static passes per priority step, by version", [
    target(f'sum by (service_version) (rate({calls("GameAction.checkStaticAbilities")}[$__rate_interval])) / sum by (service_version) (rate({calls(step)}[$__rate_interval]))', "static passes {{service_version}}", ref="A"),
    target(f'sum by (service_version) (rate({calls("GameAction.checkStateEffects")}[$__rate_interval])) / sum by (service_version) (rate({calls(step)}[$__rate_interval]))', "state checks {{service_version}}", ref="B")],
    0, 30, unit="none"))
p.append({"id": nid(), "type": "heatmap", "title": "AI spell choice latency", "datasource": PROM,
          "gridPos": {"x": 12, "y": 30, "w": 12, "h": 8},
          "targets": [target(f'sum by (le) (increase(traces_span_metrics_duration_milliseconds_bucket{{{S},span_name="PlayerControllerAi.chooseSpellAbilityToPlay"}}[$__rate_interval]))', "{{le}}", fmt="heatmap")],
          "options": {"calculate": False, "yAxis": {"unit": "ms"}, "cellGap": 1, "color": {"scheme": "Oranges", "mode": "scheme"},
                      "tooltip": {"show": True, "yHistogram": True}},
          "fieldConfig": {"defaults": {}, "overrides": []}})

p.append(row("Summary (whole time range)", 38))
by = "span_name, service_version"
p.append(table("Spans", [
    target(f'round(sum by ({by}) (increase({c_all}[$__range])))', instant=True, ref="A", fmt="table"),
    target(f'sum by ({by}) (increase({d_sum}[$__range])) / 1000', instant=True, ref="B", fmt="table"),
    target(f'sum by ({by}) (increase({d_sum}[$__range])) / sum by ({by}) (increase({d_cnt}[$__range]))', instant=True, ref="C", fmt="table"),
    target(f'histogram_quantile(0.5, sum by (le, {by}) (increase({d_bkt}[$__range])))', instant=True, ref="D", fmt="table"),
    target(f'histogram_quantile(0.95, sum by (le, {by}) (increase({d_bkt}[$__range])))', instant=True, ref="E", fmt="table"),
    target(f'histogram_quantile(0.99, sum by (le, {by}) (increase({d_bkt}[$__range])))', instant=True, ref="F", fmt="table")],
    0, 39, 24, 9,
    {"span_name": "Span", "service_version": "Version", "Value #A": "Calls", "Value #B": "Total time",
     "Value #C": "Mean", "Value #D": "p50", "Value #E": "p95", "Value #F": "p99"},
    {"Total time": "s", "Mean": "ms", "p50": "ms", "p95": "ms", "p99": "ms", "Calls": "count", "Span": {"custom.width": 380}},
    desc="Percentiles are estimated from histogram buckets, so values are bucket-accurate, not exact.", sort="Total time"))

p.append(row("Slow calls", 48))
p.append({"id": nid(), "type": "table", "title": "Slowest AI decisions (traces)", "datasource": TEMPO,
          "description": "AI decisions over 250 ms. Click a trace ID to open it with everything that ran inside the decision.",
          "gridPos": {"x": 0, "y": 49, "w": 24, "h": 10},
          "transformations": [{"id": "organize", "options": {
              "excludeByName": {"traceService": True, "service.name": True},
              "indexByName": {"time": 0, "name": 1, "duration": 2, "traceName": 3, "spanID": 4},
              "renameByName": {"time": "Start", "name": "Decision", "duration": "Duration", "traceName": "Trace root", "spanID": "Span (open trace)"}}}],
          "targets": [{"datasource": TEMPO, "refId": "A", "queryType": "traceql", "limit": 50, "tableType": "spans", "spss": 1,
                       "query": '{ resource.service.name = "forge-sim" && name =~ "PlayerControllerAi.*" && duration > 250ms }'}],
          "options": {"showHeader": True, "cellHeight": "sm", "sortBy": [{"displayName": "Duration", "desc": True}]},
          "fieldConfig": {"defaults": {}, "overrides": []}})

p.append(row("AI decision timeouts", 59))
timeouts = f'traces_span_metrics_calls_total{{{S},span_name="AiController.decisionTimeout"}}'
p.append(stat("AI decision timeouts", f'round(sum(increase({timeouts}[$__range]))) or vector(0)', 0, 60, w=6, decimals=0, thresholds=red,
              desc="Spell choices that hit the AI time cap (5 s). The AI then passes priority without playing anything, so every one is a decision the AI skipped. Target: 0."))
p.append(stat("Timeouts per 1000 AI decisions",
              f'1000 * (sum(increase({timeouts}[$__range])) or vector(0)) / sum(increase({calls("PlayerControllerAi.chooseSpellAbilityToPlay")}[$__range]))',
              0, 64, w=6, decimals=2, thresholds=red, desc="Normalized by how many spell choices the AI made, so runs of different length compare."))
p.append(table("Where the AI was stuck", [
    target(f'round(sum by (forge_ai_stuck_at, service_version) (increase({timeouts}[$__range]))) > 0', instant=True, ref="A", fmt="table")],
    6, 60, 18, 8,
    {"forge_ai_stuck_at": "Innermost AI frame of the eval thread at timeout", "service_version": "Version", "Value": "Timeouts"},
    {"Timeouts": "count", "Innermost AI frame of the eval thread at timeout": {"custom.width": 560}, "Version": {"custom.width": 300}},
    desc="Where the AI eval thread was when the cap hit. Each timeout is also a profiler sample: the full stack is printed in the sim log.", sort="Timeouts"))

hot = dashboard("forge-engine-hotpaths", "Forge engine hot paths",
                "Every @WithSpan in the engine and AI, as call counts and latency (spanmetrics from all spans, unsampled).", p,
                [var_query("version", "Version", 'label_values(traces_span_metrics_calls_total{service_name="forge-sim"}, service_version)'),
                 var_query("span", "Span", 'label_values(traces_span_metrics_calls_total{service_name="forge-sim"}, span_name)')])

# ---------------------------------------------------------------- version compare
# Two single versions side by side (bench.sh compare runs them together on the same seeds). Every panel shows
# baseline, candidate and, where lower is better, speedup = baseline / candidate (above 1 = candidate is faster).
_id[0] = 0
GA = 'service_version="$baseline",forge_scenario=~"$scenario",forge_pod=~"$pod"'
GB = 'service_version="$candidate",forge_scenario=~"$scenario",forge_pod=~"$pod"'
SA = 'service_name="forge-sim",service_version="$baseline"'
SB = 'service_name="forge-sim",service_version="$candidate"'
game = lambda m, g, extra="": f'forge_game_{m}{{{g}{extra}}}'
span = lambda m, s, name: f'traces_span_metrics_{m}{{{s},span_name="{name}"}}'
inc = lambda q: f'increase({q}[$__range])'
sec_per_turn = lambda g, by="": f'(sum{by} ({inc(game("duration_seconds_sum", g))}) / sum{by} ({inc(game("turns_sum", g))}))'
mean_ms = lambda s, name, by="": f'(sum{by} ({inc(span("duration_milliseconds_sum", s, name))}) / sum{by} ({inc(span("duration_milliseconds_count", s, name))}))'
timeout_rate = lambda s: (f'(1000 * (sum({inc(span("calls_total", s, "AiController.decisionTimeout"))}) or vector(0))'
                          f' / sum({inc(span("calls_total", s, "PlayerControllerAi.chooseSpellAbilityToPlay"))}))')
speed = {"mode": "absolute", "steps": [{"color": "red", "value": None}, {"color": "text", "value": 0.95}, {"color": "green", "value": 1.05}]}
TIMES = "suffix:×"

def pair(title, a, b, x, y, w=6, h=5, unit="none", decimals=2, desc=""):
    p = stat(title, a, x, y, w=w, h=h, unit=unit, decimals=decimals, desc=desc)
    p["targets"] = [target(a, "Baseline", instant=True, ref="A"), target(b, "Candidate", instant=True, ref="B")]
    p["options"]["textMode"] = "value_and_name"
    return p

def speedup(title, a, b, x, y, w=4, h=5, desc=""):
    return stat(title, f'({a}) / ({b})', x, y, w=w, h=h, unit=TIMES, decimals=2, thresholds=speed,
                desc=desc or "Baseline / candidate. Above 1: the candidate is faster.")

p = []
p.append({"id": nid(), "type": "text", "title": "", "gridPos": {"x": 0, "y": 0, "w": 24, "h": 2},
          "options": {"mode": "markdown", "content":
              "Pick **Baseline** and **Candidate** above. `./bench.sh compare` runs both on the same seeds, so they play the same "
              "games until an AI decision hits its 5 s cap. **Speedup** = baseline / candidate: green above 1.05, red below 0.95. "
              "Trust it only with tens of games per pod; single games vary a lot."}})
p.append(pair("Seconds per turn", sec_per_turn(GA), sec_per_turn(GB), 0, 2, unit="s",
              desc="Game wall time divided by turns played, over the whole time range."))
p.append(speedup("Speedup per turn", sec_per_turn(GA), sec_per_turn(GB), 6, 2))
p.append(pair("AI spell choice, mean", mean_ms(SA, "PlayerControllerAi.chooseSpellAbilityToPlay"),
              mean_ms(SB, "PlayerControllerAi.chooseSpellAbilityToPlay"), 10, 2, unit="ms", decimals=1))
p.append(speedup("AI speedup", mean_ms(SA, "PlayerControllerAi.chooseSpellAbilityToPlay"),
                 mean_ms(SB, "PlayerControllerAi.chooseSpellAbilityToPlay"), 16, 2))
p.append(pair("Games played", f'round(sum({inc(game("duration_seconds_count", GA))}))',
              f'round(sum({inc(game("duration_seconds_count", GB))}))', 20, 2, w=4, decimals=0,
              desc="Sample size. A faster build plays more games in the same time."))
p.append(pair("AI timeouts per 1000 decisions", timeout_rate(SA), timeout_rate(SB), 0, 7,
              desc="Spell choices that hit the 5 s cap and were skipped. Faster engine code should push this toward 0."))
p.append(pair("Avg turns per game", f'sum({inc(game("turns_sum", GA))}) / sum({inc(game("turns_count", GA))})',
              f'sum({inc(game("turns_sum", GB))}) / sum({inc(game("turns_count", GB))})', 6, 7, decimals=1,
              desc="Should match when the candidate only changes speed. A big gap means the AI plays differently."))
static_per_step = lambda s: (f'sum({inc(span("calls_total", s, "GameAction.checkStaticAbilities"))})'
                             f' / sum({inc(span("calls_total", s, "PhaseHandler.mainLoopStep"))})')
p.append(pair("Static passes per priority step", static_per_step(SA), static_per_step(SB), 12, 7,
              desc="Full continuous-effect recomputes per priority step. A delta-based engine should lower this."))
STOPPED = ',forge_outcome=~"timeout|error"'
bad = lambda g: f'round(sum({inc(game("duration_seconds_count", g, STOPPED))})) or vector(0)'
p.append(pair("Game timeouts + errors", bad(GA), bad(GB), 18, 7, decimals=0,
              desc="Games stopped by the sim clock (GAME_TIMEOUT) or an exception."))

p.append(row("By pod (whole time range)", 12))
byp = " by (forge_pod)"
cntp = lambda g: f'round(sum{byp} ({inc(game("duration_seconds_count", g))}))'
p.append(table("Pods", [
    target(cntp(GA), instant=True, ref="A", fmt="table"),
    target(cntp(GB), instant=True, ref="B", fmt="table"),
    target(sec_per_turn(GA, byp), instant=True, ref="C", fmt="table"),
    target(sec_per_turn(GB, byp), instant=True, ref="D", fmt="table"),
    target(f'{sec_per_turn(GA, byp)} / {sec_per_turn(GB, byp)}', instant=True, ref="E", fmt="table")],
    0, 13, 24, 6,
    {"forge_pod": "Pod", "Value #A": "Games (baseline)", "Value #B": "Games (candidate)",
     "Value #C": "Sec per turn (baseline)", "Value #D": "Sec per turn (candidate)", "Value #E": "Speedup"},
    {"Games (baseline)": "count", "Games (candidate)": "count", "Sec per turn (baseline)": "s", "Sec per turn (candidate)": "s",
     "Speedup": {"unit": TIMES, "thresholds": speed, "custom.cellOptions": {"type": "color-text"}},
     "Pod": {"custom.width": 560}}, sort="Speedup"))

p.append(row("Engine and AI spans (whole time range)", 19))
bys = " by (span_name)"
# the timeout marker has no duration worth comparing; its counts are in the timeout panels
NOMARK = ',span_name!="AiController.decisionTimeout"'
calls_all = lambda s: f'traces_span_metrics_calls_total{{{s}{NOMARK}}}'
per_step = lambda s: f'sum{bys} ({inc(calls_all(s))}) / scalar(sum({inc(span("calls_total", s, "PhaseHandler.mainLoopStep"))}))'
mean_all = lambda s: (f'(sum{bys} ({inc(f"traces_span_metrics_duration_milliseconds_sum{{{s}{NOMARK}}}")})'
                      f' / sum{bys} ({inc(f"traces_span_metrics_duration_milliseconds_count{{{s}{NOMARK}}}")}))')
p.append(table("Spans", [
    target(mean_all(SA), instant=True, ref="A", fmt="table"),
    target(mean_all(SB), instant=True, ref="B", fmt="table"),
    target(f'{mean_all(SA)} / {mean_all(SB)}', instant=True, ref="C", fmt="table"),
    target(per_step(SA), instant=True, ref="D", fmt="table"),
    target(per_step(SB), instant=True, ref="E", fmt="table")],
    0, 20, 24, 10,
    {"span_name": "Span", "Value #A": "Mean (baseline)", "Value #B": "Mean (candidate)", "Value #C": "Speedup",
     "Value #D": "Calls per step (baseline)", "Value #E": "Calls per step (candidate)"},
    {"Mean (baseline)": "ms", "Mean (candidate)": "ms",
     "Speedup": {"unit": TIMES, "thresholds": speed, "custom.cellOptions": {"type": "color-text"}},
     "Calls per step (baseline)": {"decimals": 3}, "Calls per step (candidate)": {"decimals": 3},
     "Span": {"custom.width": 380}},
    desc="Mean time per call (children included) and calls per priority step. Calls per step should match unless the "
         "candidate skips or adds work; a change there with the same games means the engine does less (or more) per action.",
    sort="Speedup"))

p.append(row("Over time (1 h rolling)", 29))
roll = lambda q: f'increase({q}[1h])'
spt_roll = lambda g: f'sum({roll(game("duration_seconds_sum", g))}) / sum({roll(game("turns_sum", g))})'
p.append(ts("Seconds per turn", [target(spt_roll(GA), "Baseline", ref="A"), target(spt_roll(GB), "Candidate", ref="B")],
            0, 30, unit="s", desc="Over the hour before each point, so it is smooth even though games finish minutes apart."))
ai_roll = lambda s: (f'sum({roll(span("duration_milliseconds_sum", s, "PlayerControllerAi.chooseSpellAbilityToPlay"))})'
                     f' / sum({roll(span("duration_milliseconds_count", s, "PlayerControllerAi.chooseSpellAbilityToPlay"))})')
p.append(ts("AI spell choice, mean", [target(ai_roll(SA), "Baseline", ref="A"), target(ai_roll(SB), "Candidate", ref="B")],
            12, 30, unit="ms"))
games_roll = lambda g: f'sum({roll(game("duration_seconds_count", g))})'
p.append(ts("Games per hour", [target(games_roll(GA), "Baseline", ref="A"), target(games_roll(GB), "Candidate", ref="B")],
            0, 38, unit="none"))
to_roll = lambda s: (f'1000 * (sum({roll(span("calls_total", s, "AiController.decisionTimeout"))}) or vector(0))'
                     f' / sum({roll(span("calls_total", s, "PlayerControllerAi.chooseSpellAbilityToPlay"))})')
p.append(ts("AI timeouts per 1000 decisions", [target(to_roll(SA), "Baseline", ref="A"), target(to_roll(SB), "Candidate", ref="B")],
            12, 38, unit="none", desc="Per decision, not per hour: a faster build makes more decisions per hour, so raw counts would rise."))

p.append(row("Did the games change? (whole time range)", 46))
won = lambda g: f'round(sum by (forge_pod, forge_outcome) ({inc(game("duration_seconds_count", g))}))'
# whole games first: increase() extrapolates each series a little differently, so shares of raw values don't add up
share = lambda g: f'{won(g)} / ignoring (forge_outcome) group_left sum by (forge_pod) ({won(g)})'
p.append(table("Winners", [
    target(share(GA), instant=True, ref="A", fmt="table"),
    target(share(GB), instant=True, ref="B", fmt="table"),
    target(won(GA), instant=True, ref="C", fmt="table"),
    target(won(GB), instant=True, ref="D", fmt="table")],
    0, 47, 24, 10,
    {"forge_pod": "Pod", "forge_outcome": "Winner", "Value #A": "Share of pod's games (baseline)",
     "Value #B": "Share of pod's games (candidate)", "Value #C": "Games (baseline)", "Value #D": "Games (candidate)"},
    {"Share of pod's games (baseline)": "percentunit", "Share of pod's games (candidate)": "percentunit",
     "Games (baseline)": "count", "Games (candidate)": "count", "Pod": {"custom.width": 520}, "Winner": {"custom.width": 260}},
    desc="How often each commander won its pod, per build. Same seeds: a speed-only change should give similar shares. "
         "Games diverge after an AI timeout, and the faster build plays more games, so expect some drift, not a different story.",
    sort="Share of pod's games (baseline)"))

def single_var(name, label, default):
    v = var_query(name, label, 'label_values(forge_game_duration_seconds_count, service_version)', include_all=False, multi=False)
    v["current"] = {"selected": True, "text": default, "value": default}
    return v

for panel in p:
    if panel["type"] == "timeseries":
        panel["fieldConfig"]["overrides"] = [
            {"matcher": {"id": "byName", "options": name}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": color}}]}
            for name, color in (("Baseline", "#8e8e8e"), ("Candidate", "green"))]

compare = dashboard("forge-version-compare", "Forge version compare",
                    "Baseline vs candidate build: speed per turn, per pod and per span, AI timeouts, and whether the games changed.", p,
                    [single_var("baseline", "Baseline", "v1.0.0-6-baseline"),
                     single_var("candidate", "Candidate", "v1.0.0-6-trait-cache"),
                     var_query("scenario", "Scenario", 'label_values(forge_game_duration_seconds_count{service_version=~"$baseline|$candidate"}, forge_scenario)'),
                     var_query("pod", "Pod", 'label_values(forge_game_duration_seconds_count{service_version=~"$baseline|$candidate"}, forge_pod)')])
compare["time"] = {"from": "now-6h", "to": "now"}

os.makedirs(OUT, exist_ok=True)
for d, name in ((overview, "forge-sim-overview.json"), (hot, "forge-engine-hotpaths.json"), (compare, "forge-version-compare.json")):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
print("written")
