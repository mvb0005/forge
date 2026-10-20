import base64, json, math, re, sys, urllib.request

# Usage: python check_dashboards.py [range, default 30m]
# Runs every panel query of the Forge dashboards through Grafana's /api/ds/query, as the panels would (with each
# variable's default, or .* for "All"),
# and reports per query: error, how many series came back, and whether any value is real (not empty/NaN).
GRAFANA = "http://127.0.0.1:3000"
AUTH = "Basic " + base64.b64encode(b"admin:admin").decode()
RANGE = sys.argv[1] if len(sys.argv) > 1 else "30m"

def call(path, body=None):
    req = urllib.request.Request(GRAFANA + path, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": AUTH, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"http_error": e.code, "body": e.read().decode()[:300]}

bad = 0
for uid in ("forge-sim-overview", "forge-engine-hotpaths", "forge-version-compare"):
    dash = call(f"/api/dashboards/uid/{uid}")["dashboard"]
    print(f"=== {dash['title']}")
    # a single-valued variable keeps its default; "All" variables become .*
    values = {}
    for v in dash.get("templating", {}).get("list", []):
        cur = v.get("current", {}).get("value")
        values[v["name"]] = cur if isinstance(cur, str) and cur != "$__all" else ".*"
    for panel in dash["panels"]:
        if panel["type"] in ("row", "text"):
            continue
        for t in panel["targets"]:
            q = dict(t)
            if "expr" in q:
                # $__range etc. are left for Grafana
                q["expr"] = re.sub(r"\$(?!__)([a-z_]+)", lambda m: values.get(m.group(1), ".*"), q["expr"])
            q["intervalMs"] = 60000
            q["maxDataPoints"] = 200
            res = call("/api/ds/query", {"from": f"now-{RANGE}", "to": "now", "queries": [q]})
            r = res.get("results", {}).get(t["refId"], {}) if "results" in res else {}
            err = res.get("http_error") and res.get("body") or r.get("error")
            series, real = 0, 0
            for fr in r.get("frames", []):
                vals = fr.get("data", {}).get("values", [])
                series += 1
                for col in vals[1:] if len(vals) > 1 else vals:
                    for v in col:
                        if isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v)):
                            real += 1
                        elif isinstance(v, str) and v:
                            real += 1
            ok = not err and series > 0 and real > 0
            bad += not ok
            print(f"{'ok ' if ok else 'BAD'} {panel['title'][:45]:45} {t['refId']} series={series} values={real} {err or ''}")
print("problems:", bad)
