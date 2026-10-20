#!/usr/bin/env bash
# Builds the forge-sim image from the current code and (re)starts the benchmark stack.
#   ./bench.sh up [change-name]   build jar + image, start Grafana/OTel and the sim loop
#   ./bench.sh down               stop everything; collected data stays in the forge-bench-data volume
#   ./bench.sh logs               follow the sim output
#   ./bench.sh backup [dir]       copy all collected telemetry to dir (default ~/forge-bench-backups)
# Each build gets a readable version <VERSION>-<build#>-<change-name>, e.g. v1.0.1-3-cache-combat-predictions,
# shown as the Version in Grafana. change-name defaults to the git branch. The exact code is kept as forge.commit:
# <commit>[-dirty-<diff hash>].
set -euo pipefail
cd "$(dirname "$0")"

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
        change=${2:-$(git rev-parse --abbrev-ref HEAD)}
        change=$(echo "$change" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9.]+/-/g; s/^-+|-+$//g')
        build=$(( $(cat .build-number 2>/dev/null || echo 0) + 1 ))
        (cd .. && ${MVN:-mvn} -q -pl forge-gui-desktop -am package -DskipTests -Dcheckstyle.skip)
        echo "$build" > .build-number
        export FORGE_VERSION="$(tr -d '[:space:]' < VERSION)-$build-$change"
        export FORGE_COMMIT=$(commit)
        echo "forge-sim $FORGE_VERSION ($FORGE_COMMIT)"
        docker compose up -d --build
        ;;
    down)
        shift
        docker compose down "$@"
        ;;
    logs)
        docker compose logs -f forge-sim
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
        echo "usage: $0 [up [change-name]|down [-v]|logs|backup [dir]]" >&2
        exit 1
        ;;
esac
