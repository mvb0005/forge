#!/usr/bin/env bash
# Builds the forge-sim image from the current code and (re)starts the benchmark stack.
#   ./bench.sh up [change-name]   build jar + image, start Grafana/OTel and the sim loop
#   ./bench.sh down               stop everything; collected data stays in the forge-bench-data volume
#   ./bench.sh logs               follow the sim output
#   ./bench.sh backup [dir]       copy all collected telemetry to dir (default ~/forge-bench-backups)
#   ./bench.sh compare [ref] [change]  A/B: one sim of the current code and one built from git ref (default HEAD),
#                                 on the same seeds, labelled <VERSION>-<build#>-<change> and <VERSION>-<build#>-baseline
# Each build gets a readable version <VERSION>-<build#>-<change-name>, e.g. v1.0.1-3-cache-combat-predictions,
# shown as the Version in Grafana. change-name defaults to the git branch. The exact code is kept as forge.commit:
# <commit>[-dirty-<diff hash>].
set -euo pipefail
cd "$(dirname "$0")"

# builds the desktop jar in the given source tree
build_jar() {
    (cd "$1" && ${MVN:-mvn} -q -pl forge-gui-desktop -am package -DskipTests -Dcheckstyle.skip)
}

change_name() {
    echo "${1:-$(git rev-parse --abbrev-ref HEAD)}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9.]+/-/g; s/^-+|-+$//g'
}

next_build() {
    build=$(( $(cat .build-number 2>/dev/null || echo 0) + 1 ))
    echo "$build" > .build-number
}

commit() {
    local c
    c=$(git rev-parse --short HEAD)
    if [[ -n "$(git status --porcelain -- .. ':!bench')" ]]; then
        c="$c-dirty-$( (git diff HEAD -- .. ':!bench'; git ls-files --others --exclude-standard -- .. ':!bench' | xargs -r cat) | git hash-object --stdin | cut -c1-7)"
    fi
    echo "$c"
}

case "${1:-up}" in
    up)
        docker volume inspect forge-bench-data >/dev/null 2>&1 || docker volume create forge-bench-data >/dev/null
        change=$(change_name "${2:-}")
        build_jar ..
        next_build
        export FORGE_VERSION="$(tr -d '[:space:]' < VERSION)-$build-$change"
        export FORGE_COMMIT=$(commit)
        echo "forge-sim $FORGE_VERSION ($FORGE_COMMIT)"
        # a baseline left over from `compare` would keep running next to this version
        docker compose --profile compare rm -sf forge-sim-baseline >/dev/null 2>&1 || true
        docker compose up -d --build
        ;;
    compare)
        docker volume inspect forge-bench-data >/dev/null 2>&1 || docker volume create forge-bench-data >/dev/null
        ref=${2:-HEAD}
        change=$(change_name "${3:-}")
        sha=$(git rev-parse --short "$ref")
        if [[ -d .baseline ]]; then
            git -C .baseline checkout -q --detach "$sha"
        else
            git worktree add -q --detach .baseline "$sha"
        fi
        build_jar .baseline
        build_jar ..
        next_build
        version="$(tr -d '[:space:]' < VERSION)-$build"
        export FORGE_VERSION="$version-$change" FORGE_COMMIT=$(commit)
        export BASELINE_VERSION="$version-baseline" BASELINE_COMMIT=$sha
        # one sim each, on the same seeds: they play the same games until an AI decision hits its time cap
        export SIM_REPLICAS=1 SEED=${SEED:-$(( RANDOM * 32768 + RANDOM ))}
        echo "forge-sim $FORGE_VERSION ($FORGE_COMMIT) vs $BASELINE_VERSION ($sha), seed $SEED"
        docker compose --profile compare up -d --build
        ;;
    down)
        shift
        docker compose --profile compare down "$@"
        ;;
    logs)
        docker compose --profile compare logs -f forge-sim forge-sim-baseline
        ;;
    backup)
        # copies all telemetry (Prometheus, Tempo, Grafana) out of Docker; lgtm is paused so the files are consistent
        dir=${2:-$HOME/forge-bench-backups}
        mkdir -p "$dir"
        file="forge-bench-data-$(date +%Y%m%d-%H%M%S).tar.gz"
        docker compose stop lgtm
        MSYS_NO_PATHCONV=1 docker run --rm -v forge-bench-data:/data:ro -v "$(cd "$dir" && pwd -W 2>/dev/null || pwd)":/backup \
            alpine:3.20.3 tar czf "/backup/$file" -C /data .
        docker compose start lgtm
        echo "backed up to $dir/$file"
        ;;
    *)
        echo "usage: $0 [up [change-name]|compare [ref] [change-name]|down [-v]|logs|backup [dir]]" >&2
        exit 1
        ;;
esac
