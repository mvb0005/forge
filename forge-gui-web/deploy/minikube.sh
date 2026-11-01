#!/usr/bin/env bash
# Run the Forge web game server on minikube, next to mtg-tracker (same cluster, its own namespace).
# Run from WSL, where the cluster lives. Build the jar and the UI first (README "Hosted play").
#
#   deploy/minikube.sh secret               set the control API's shared secret, for the game server and mtg-tracker
#   deploy/minikube.sh up                   build the image, load it into minikube, make it the table template, apply
#                                           the router and the rest (running tables keep their build until they end)
#   deploy/minikube.sh load-pics [DIR]      copy card images into the forge-pics volume (default: the desktop's Forge image cache)
#   deploy/minikube.sh load-data DIR        copy a play log directory (DIR/play) into the forge-data volume
#   deploy/minikube.sh forward [PORT]       port-forward the router to http://127.0.0.1:PORT/play/table/<id>/ (default 7781)
#   deploy/minikube.sh tables               list the table pods (spare, playing, done)
#   deploy/minikube.sh logs [ID]            follow a table's log, or the router's
#   deploy/minikube.sh down                 delete the router and every table (games end) but keep the volumes
set -euo pipefail

cd "$(dirname "$0")/.."

NS=forge
IMAGE=forge-web:dev
PICS_DEFAULT=/mnt/c/Users/admin/AppData/Local/Forge/Cache/pics
KUBECTL=(kubectl --namespace "$NS")

# The control API's shared secret, as the forge-control Secret in both namespaces: the game server (forge)
# and mtg-tracker (mtgtracker), which reads it as FORGE_CONTROL_SECRET.
cmd_secret() {
  local secret
  if [[ -t 0 ]]; then
    read -rsp "Control secret (leave empty to generate one): " secret
    echo
  else
    secret=$(cat)
  fi
  [[ -n $secret ]] || secret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  kubectl apply -f deploy/k8s/namespace.yaml >/dev/null
  for ns in forge mtgtracker; do
    printf '%s' "$secret" | kubectl --namespace "$ns" create secret generic forge-control --from-file=secret=/dev/stdin \
      --dry-run=client -o yaml | kubectl --namespace "$ns" apply -f -
  done
  echo "Secret forge-control set in forge and mtgtracker. Restart mtg-tracker to pick it up."
}

cmd_up() {
  "${KUBECTL[@]}" get secret forge-control >/dev/null 2>&1 || { echo "no control secret: run deploy/minikube.sh secret first" >&2; exit 1; }
  ls target/forge-gui-web-*-jar-with-dependencies.jar >/dev/null
  [[ -f ui/dist/index.html ]] || { echo "no ui/dist: run npm run build in ui/" >&2; exit 1; }
  # A tag per build: minikube keeps the old image under a reused tag while a pod holds it, so loading
  # forge-web:dev again silently left the old code running. A new tag also makes the rollout itself.
  local tag
  tag="forge-web:$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
  [[ -z $(git status --porcelain -- .) ]] || tag+="-dirty"
  # Build with Windows' own docker.exe when the checkout is on the Windows drive: it reads forge-gui/res
  # (tens of thousands of small files) natively, seconds instead of minutes over /mnt/c. Same Docker
  # Desktop engine, so minikube loads the image either way.
  local docker=(docker) here=$PWD
  if [[ $PWD == /mnt/* ]] && command -v docker.exe >/dev/null 2>&1; then
    docker=(docker.exe)
    here=$(wslpath -w "$PWD")
  fi
  "${docker[@]}" build -t "$tag" \
    --build-context res="$here/../forge-gui/res" \
    --build-context jar="$here/target" \
    --build-context ui="$here/ui/dist" \
    "$here/docker"
  minikube image load "$tag"
  # The new build only goes into the table template: mtg-tracker swaps the spare for one on it, and running
  # tables keep theirs until their game ends.
  kubectl kustomize deploy/k8s | sed "s#\"$IMAGE\"#\"$tag\"#" | kubectl apply -f -
  "${KUBECTL[@]}" rollout status deployment/forge-router --timeout=120s
  echo "New tables run $tag"
}

# A short-lived pod with a volume mounted read-write, to copy files into it.
with_loader() {
  local claim=$1 mount=$2
  "${KUBECTL[@]}" delete pod forge-loader --ignore-not-found --wait=true >/dev/null
  "${KUBECTL[@]}" apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: forge-loader
spec:
  securityContext:
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
  containers:
    - name: loader
      image: busybox:1.36
      command: ["sleep", "3600"]
      volumeMounts:
        - name: target
          mountPath: $mount
  volumes:
    - name: target
      persistentVolumeClaim:
        claimName: $claim
EOF
  "${KUBECTL[@]}" wait --for=condition=Ready pod/forge-loader --timeout=120s
  trap '"${KUBECTL[@]}" delete pod forge-loader --ignore-not-found --wait=false >/dev/null' RETURN
}

cmd_load_pics() {
  local src=${1:-$PICS_DEFAULT}
  [[ -d $src ]] || { echo "no image cache at $src" >&2; exit 1; }
  kubectl apply -k deploy/k8s >/dev/null
  with_loader forge-pics /pics
  tar -C "$src" -cf - . | "${KUBECTL[@]}" exec -i forge-loader -- tar -C /pics -xf -
  "${KUBECTL[@]}" exec forge-loader -- du -sh /pics
}

cmd_load_data() {
  local src=${1:?usage: load-data DIR (the directory holding play/)}
  [[ -d $src/play ]] || { echo "no play/ in $src" >&2; exit 1; }
  kubectl apply -k deploy/k8s >/dev/null
  with_loader forge-data /data
  tar -C "$src" -cf - play | "${KUBECTL[@]}" exec -i forge-loader -- tar -C /data -xf -
  "${KUBECTL[@]}" exec forge-loader -- ls /data/play
}

cmd_forward() {
  local port=${1:-7781}
  while true; do
    "${KUBECTL[@]}" port-forward service/forge-web "$port:80" || true
    sleep 2
  done
}

case "${1:-}" in
  secret) cmd_secret ;;
  up) cmd_up ;;
  load-pics) shift; cmd_load_pics "$@" ;;
  load-data) shift; cmd_load_data "$@" ;;
  forward) shift; cmd_forward "$@" ;;
  tables) "${KUBECTL[@]}" get pods -l app=forge-table -L forge/state -o wide ;;
  logs) if [[ -n ${2:-} ]]; then "${KUBECTL[@]}" logs -f "forge-table-$2"; else "${KUBECTL[@]}" logs -f deployment/forge-router; fi ;;
  down)
    "${KUBECTL[@]}" delete deployment forge-router --ignore-not-found
    "${KUBECTL[@]}" delete pods -l app=forge-table --ignore-not-found ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
