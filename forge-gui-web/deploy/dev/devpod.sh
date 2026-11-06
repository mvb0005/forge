#!/usr/bin/env bash
# Runs one branch in a dev pod (README "Dev pods").
#
# The branch comes from the shared mirror at /git, which Windows pushes to on every commit. A new commit on the
# branch is checked out within 0.2 s.
#   - Java: the modules the branch changed since $BASE_SHA (the commit of the deployed image whose jar is
#     /base/forge-web.jar) are compiled against that jar, together with the modules after them. Then the game
#     server restarts.
#   - res/ (card scripts and the like) is read from the checkout, so a change to it also restarts the server.
#   - The UI: Vite serves it from the checkout and reloads it by itself.
# State goes to /work/status.json; logs to /work/{dev,build,server,vite}.log.
set -uo pipefail

W=/work R=/work/repo OUT=/work/out BASE=/base/forge-web.jar
MODULES=(forge-core forge-game forge-ai forge-gui forge-gui-web)
: "${BRANCH:?}" "${BASE_SHA:?}" "${JAVA_OPTS:=-Xmx1536m}"
C="" JPID="" VPID="" CP=$BASE COMPILED=0
declare -A BUILT # module -> the tree it was last compiled from

say() { echo "[$(date +%T)] $*"; }
state() {
  printf '{"branch":"%s","commit":"%s","state":"%s","detail":"%s","base":"%s","at":"%s"}\n' \
    "$BRANCH" "$C" "$1" "${2:-}" "$BASE_SHA" "$(date -u +%FT%TZ)" > $W/status.tmp && mv $W/status.tmp $W/status.json
  say "$1 ${2:-}"
}
tree() { git -C $R rev-parse -q --verify "$1:$2/src/main" 2>/dev/null; }

# Every module from the first one the branch changed onward is compiled from the checkout, the rest come from
# the base jar. A module is compiled again when its source changed since last time, or one before it was.
compile() {
  local first=-1 i m t again=0
  COMPILED=0 CP=$BASE
  for i in "${!MODULES[@]}"; do
    [[ $(tree "$C" "${MODULES[i]}") != $(tree "$BASE_SHA" "${MODULES[i]}") ]] && { first=$i; break; }
  done
  ((first < 0)) && return 0
  for ((i = first; i < ${#MODULES[@]}; i++)); do
    m=${MODULES[i]} t=$(tree "$C" "${MODULES[i]}")
    if ((again)) || [[ ${BUILT[$m]:-} != "$t" || ! -d $OUT/$m ]]; then
      state building "$m"
      rm -rf "$OUT/$m.new" && mkdir -p "$OUT/$m.new"
      git -C $R ls-files "$m/src/main/java" | grep '\.java$' | sed "s#^#$R/#" > $W/sources
      if ! javac -nowarn -encoding UTF-8 --release 17 -proc:none -d "$OUT/$m.new" -cp "$CP" @$W/sources >> $W/build.log 2>&1; then
        BUILT[$m]=""
        return 1
      fi
      [[ -d $R/$m/src/main/resources ]] && cp -r "$R/$m/src/main/resources/." "$OUT/$m.new/"
      rm -rf "$OUT/$m" && mv "$OUT/$m.new" "$OUT/$m"
      BUILT[$m]=$t again=1 COMPILED=1
    fi
    CP=$OUT/$m:$CP
  done
}

start_server() {
  (cd $R/forge-gui && exec java -Duser.home=$W/home $JAVA_OPTS -cp "$CP" forge.web.WebMain \
    --host 0.0.0.0 --port 7777 --control-host 127.0.0.1 --pics /pics) >> $W/server.log 2>&1 &
  JPID=$!
  for _ in $(seq 1 300); do
    curl -fs -o /dev/null http://127.0.0.1:7790/healthz && { state running; return 0; }
    kill -0 $JPID 2>/dev/null || break
    sleep 0.2
  done
  state failed "the server didn't start: dev logs server"
}

stop_server() {
  [[ -n $JPID ]] || return 0
  kill $JPID 2>/dev/null
  wait $JPID 2>/dev/null
  JPID=""
}

start_vite() {
  [[ -n $VPID ]] && { kill $VPID 2>/dev/null; wait $VPID 2>/dev/null; }
  (cd $R/forge-gui-web/ui && npm ci --no-audit --no-fund --loglevel=error --cache /npm-cache >> $W/vite.log 2>&1 \
    && exec node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort >> $W/vite.log 2>&1) &
  VPID=$!
}

# A commit that doesn't compile leaves the last good server running.
build_and_run() {
  if compile; then
    stop_server
    start_server
  else
    state failed "compile: dev logs build (still running the last good build)"
  fi
}

trap 'stop_server; [[ -n $VPID ]] && kill $VPID; exit 0' TERM INT
mkdir -p $W/home $OUT
touch $W/build.log $W/server.log $W/vite.log

git clone -q --shared --no-checkout /git $R || { say "no mirror at /git"; exit 1; }
C=$(git --git-dir=/git rev-parse -q --verify "refs/heads/$BRANCH") || { say "no branch $BRANCH in the mirror"; exit 1; }
git -C $R -c advice.detachedHead=false checkout -q -f "$C"
state starting
start_vite
build_and_run

while true; do
  sleep 0.2
  new=$(git --git-dir=/git rev-parse -q --verify "refs/heads/$BRANCH") || continue
  [[ $new == "$C" ]] && continue
  git -C $R fetch -q origin "$BRANCH" || continue
  changed=$(git -C $R diff --name-only "$C" "$new")
  C=$new
  git -C $R -c advice.detachedHead=false checkout -q -f "$C"
  say "commit $(git -C $R log -1 --format='%h %s')"
  if grep -qE '^forge-gui-web/ui/package(-lock)?\.json$' <<< "$changed"; then start_vite; fi
  if grep -qE '^[^/]+/src/main/|^forge-gui/res/' <<< "$changed"; then
    build_and_run
  else
    state running "ui only"
  fi
done
