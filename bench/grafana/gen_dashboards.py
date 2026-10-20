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

os.makedirs(OUT, exist_ok=True)
for d, name in ((overview, "forge-sim-overview.json"), (hot, "forge-engine-hotpaths.json")):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
print("written")
