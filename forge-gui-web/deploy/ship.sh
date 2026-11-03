#!/usr/bin/env bash
# Ship the Forge web game server to minikube: build, UI tests, deploy, wait until the spare table runs
# the new build, and say how to roll back. Run from Git Bash on Windows (Maven, Node and the JDK are
# there); the deploy runs in WSL, where the cluster is.
#
#   deploy/ship.sh                 refuse uncommitted changes, build the jar and UI, test the UI, deploy
#   deploy/ship.sh --rollback TAG  make TAG (an earlier forge-web:... image, still in minikube) the table
#                                  template again, and wait for the spare to run it
#
# A deploy only changes the template new tables start from: running games keep their build until they end.
set -euo pipefail
cd "$(dirname "$0")/.."

MVN=${MVN:-/c/tools/apache-maven-3.9.9/bin/mvn}
export JAVA_HOME=${FORGE_JAVA_HOME:-"/c/Program Files/Eclipse Adoptium/jdk-17.0.14.7-hotspot"}

win=$(pwd -W)                                   # C:/code/forge/forge-gui-web
here="/mnt/${win:0:1}"; here="${here,,}${win:2}" # /mnt/c/code/forge/forge-gui-web
in_wsl() { MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash -lc "cd '$here' && $1"; }
template() {
  in_wsl "kubectl -n forge get configmap forge-table -o jsonpath='{.data.pod\.json}'" | grep -o 'forge-web:[^"]*' | head -1
}

# The tracker replaces the spare table with one on the new template; wait for it (up to 3 minutes).
wait_spare() {
  local tag=$1 out
  for _ in $(seq 36); do
    out=$(in_wsl "kubectl -n forge get pods -l forge/state=spare -o jsonpath='{range .items[*]}{.status.phase} {.spec.containers[0].image}{\"\n\"}{end}'" | tr -d '\r')
    grep -qx "Running $tag" <<<"$out" && { echo "spare table running $tag"; return 0; }
    sleep 5
  done
  echo "spare table not on $tag after 3 minutes: ${out:-no spare}" >&2
  return 1
}

if [[ ${1:-} == --rollback ]]; then
  tag=${2:?usage: deploy/ship.sh --rollback forge-web:<tag>  (deploy/ship.sh prints the previous tag)}
  in_wsl "minikube image ls | grep -q 'library/$tag\$'" || { echo "$tag is not in minikube (minikube image ls | grep forge-web)" >&2; exit 1; }
  from=$(template)
  in_wsl "kubectl kustomize deploy/k8s | sed 's#\"forge-web:dev\"#\"$tag\"#' | kubectl apply -f - >/dev/null"
  echo "Table template: $from -> $tag"
  wait_spare "$tag"
  exit
fi

[[ -z $(git status --porcelain -uno -- ..) ]] || { echo "Uncommitted changes: commit first, so the build is a commit you can revert." >&2; exit 1; }
(cd .. && "$MVN" -q -o -pl forge-gui-web -am package -DskipTests)
(cd ui && npx tsc -p tsconfig.app.json --noEmit && npx vitest run && npm run build)
prev=$(template)
out=$(in_wsl "bash deploy/minikube.sh up" | tee /dev/stderr)
tag=$(grep -o 'New tables run forge-web:[^ ]*' <<<"$out" | awk '{print $4}' | tr -d '\r')
[[ -n $tag ]] || { echo "deploy/minikube.sh up didn't report the new tag" >&2; exit 1; }
wait_spare "$tag" || { echo "Roll back: deploy/ship.sh --rollback $prev" >&2; exit 1; }

echo
echo "Shipped $(git log -1 --format='%h %s') as $tag (games already running keep their build)"
echo "Roll back: deploy/ship.sh --rollback $prev, then git revert what you don't want before the next ship."
