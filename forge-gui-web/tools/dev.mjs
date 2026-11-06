// Dev pods (README "Dev pods"): run a branch on minikube, in its own pod, kept up to date from your commits.
//
//   node tools/dev.mjs up [--branch B] [--ttl 4h]   start a pod for the branch (default: the current one), print its URLs
//   node tools/dev.mjs ls                           every dev pod: branch, state, commit, URLs, time left
//   node tools/dev.mjs status [NAME]                one pod's state (default: the current branch's)
//   node tools/dev.mjs logs [NAME] [dev|build|server|vite] [--lines N]
//   node tools/dev.mjs game [NAME] [start.mjs args]  start a match on the pod (tools/start.mjs) and print the seat links
//   node tools/dev.mjs forward [NAME]               port-forward again (after a WSL restart, say)
//   node tools/dev.mjs push [--branch B]            push the branch now (the post-commit hook does this on every commit)
//   node tools/dev.mjs down [NAME | --all]          delete the pod
//   node tools/dev.mjs setup                        build the dev image, apply deploy/dev/k8s.yaml, add the `dev` remote and the hook
//
// Each commit on a branch with a pod is pushed to the mirror in the cluster (the post-commit hook, in the
// background; see .git/dev-push.log). The pod checks it out at once. A UI change reloads in the browser; a
// Java or res/ change is compiled in the pod and restarts its game server. A pod stops at its TTL and is deleted
// by the cleanup job; its port-forward ends with it. Windows node (WSL's has no WebSocket).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const devDir = join(web, "deploy", "dev");
const NS = "forge-dev";
const REMOTE_URL = `ext::wsl.exe -d Ubuntu -- kubectl -n ${NS} exec -i deploy/forge-git -c git -- %S /git`;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);
const VALUED = new Set(["--branch", "--ttl", "--lines"]);
const positional = args.slice(1).filter((a, i, all) => !a.startsWith("--") && !VALUED.has(all[i - 1]));

function run(bin, argv, { input, check = true, quiet = false } = {}) {
  // windowsHide: without it, every wsl.exe and git started from a windowless parent flashes up a console window.
  const r = spawnSync(bin, argv, { input, encoding: "utf8", maxBuffer: 1 << 26, windowsHide: true });
  if (check && r.status !== 0) {
    if (!quiet) process.stderr.write(r.stderr || r.stdout || "");
    throw new Error(`${bin} ${argv.slice(0, 6).join(" ")} failed (${r.status})`);
  }
  return r;
}
const wsl = (argv, o) => run("wsl.exe", ["-d", "Ubuntu", "--", ...argv], o);
const kubectl = (argv, o) => wsl(["kubectl", "-n", NS, ...argv], o);
const git = (argv, o) => run("git", argv, o).stdout.trim();

const slug = (branch) => branch.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
const podName = (branch) => `dev-${slug(branch)}`;
const currentBranch = () => git(["symbolic-ref", "--short", "HEAD"]);

function parseTtl(s) {
  const m = /^(\d+)([smhd]?)$/.exec(s);
  if (!m) throw new Error(`--ttl: ${s} (say 90m, 4h)`);
  return Number(m[1]) * { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
}

// The dev image is tagged by its content, so a changed Dockerfile or devpod.sh is a new tag (minikube keeps the
// old image under a reused tag while a pod holds it).
function devImage() {
  const h = createHash("sha256");
  // Without CR: a fresh worktree checks these out with CRLF, which must not count as a new image.
  for (const f of ["Dockerfile", "devpod.sh"]) h.update(readFileSync(join(devDir, f), "utf8").replaceAll(String.fromCharCode(13), ""));
  return `forge-dev:${h.digest("hex").slice(0, 12)}`;
}

function ensureImage(tag) {
  const have = wsl(["minikube", "image", "ls"]).stdout;
  if (have.includes(`docker.io/library/${tag}`)) return;
  console.log(`building ${tag}`);
  run("docker", ["build", "-q", "-t", tag, devDir]);
  wsl(["minikube", "image", "load", tag]);
}

function setup() {
  const tag = devImage();
  ensureImage(tag);
  const yaml = readFileSync(join(devDir, "k8s.yaml"), "utf8").replaceAll("forge-dev:latest", tag);
  wsl(["kubectl", "apply", "-f", "-"], { input: yaml });
  kubectl(["rollout", "status", "deployment/forge-git", "--timeout=180s"]);
  const remotes = git(["remote"]).split("\n");
  if (!remotes.includes("dev")) git(["remote", "add", "dev", REMOTE_URL]);
  else git(["remote", "set-url", "dev", REMOTE_URL]);
  // "user": only commands you run (and the hook) may use ext::, not a URL arriving through a submodule.
  git(["config", "protocol.ext.allow", "user"]);
  const hooks = git(["rev-parse", "--git-path", "hooks"]);
  const hookFile = join(hooks.startsWith("/") || /^[A-Za-z]:/.test(hooks) ? hooks : join(process.cwd(), hooks), "post-commit");
  const hook = readFileSync(join(devDir, "post-commit"), "utf8");
  if (!existsSync(hookFile) || readFileSync(hookFile, "utf8") !== hook) writeFileSync(hookFile, hook, { mode: 0o755 });
  return tag;
}

function push(branch) {
  const t = Date.now();
  run("git", ["push", "-q", "-f", "dev", `refs/heads/${branch}:refs/heads/${branch}`]);
  console.log(`pushed ${branch} in ${Date.now() - t} ms`);
}

// The deployed table image: its jar is what a dev pod compiles against, and its commit what it diffs from.
function tableImage() {
  const cm = JSON.parse(wsl(["kubectl", "-n", "forge", "get", "configmap", "forge-table", "-o", "json"]).stdout);
  const pod = JSON.parse(cm.data["pod.json"]);
  const image = pod.spec.containers[0].image;
  const sha = /^forge-web:([0-9a-f]+)-/.exec(image)?.[1];
  if (!sha) throw new Error(`can't read a commit from the table image ${image}`);
  return { image, sha: git(["rev-parse", sha]) };
}

const portFree = (port) =>
  new Promise((ok) => {
    const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true)));
    s.listen(port, "127.0.0.1");
  });

async function pickPorts(pods) {
  const taken = new Set(pods.flatMap((p) => ports(p)));
  for (let base = 6100; base < 7000; base += 10) {
    const want = [base, base + 1, base + 2];
    if (want.some((p) => taken.has(p))) continue;
    if ((await Promise.all(want.map(portFree))).every(Boolean)) return want;
  }
  throw new Error("no free ports in 6100-7000");
}

const ports = (pod) => (pod.metadata.annotations?.["forge-dev/ports"] ?? "").split(",").filter(Boolean).map(Number);
const listPods = () => JSON.parse(kubectl(["get", "pods", "-l", "app=forge-dev", "-o", "json"]).stdout).items;
const getPod = (name) => listPods().find((p) => p.metadata.name === name);

// The pattern's [p] keeps pkill from matching its own command line.
const unforward = (name) => wsl(["pkill", "-f", `[p]ort-forward pod/${name} `], { check: false });

// The forward ends with the pod: at its TTL, or within 15 s of the pod stopping or being deleted.
function forward(pod) {
  const name = pod.metadata.name;
  const [ui, http, control] = ports(pod);
  const left = Math.max(60, Math.floor((Date.parse(pod.metadata.annotations["forge-dev/expires"]) - Date.now()) / 1000));
  unforward(name);
  const script = `kubectl -n ${NS} port-forward pod/${name} ${ui}:5173 ${http}:7777 ${control}:7790 >/dev/null 2>&1 & pf=$!
trap 'kill $pf 2>/dev/null' EXIT
while kill -0 $pf 2>/dev/null && [ "$(kubectl -n ${NS} get pod ${name} -o jsonpath='{.status.phase}' 2>/dev/null)" = Running ]; do sleep 15; done`;
  const child = spawn("wsl.exe", ["-d", "Ubuntu", "-e", "timeout", String(left), "bash", "-c", script],
    { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function status(name) {
  const r = kubectl(["exec", name, "-c", "dev", "--", "cat", "/work/status.json"], { check: false });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function describe(pod) {
  const a = pod.metadata.annotations ?? {};
  const [ui] = ports(pod);
  const s = pod.status.phase === "Running" ? status(pod.metadata.name) : null;
  const left = Math.round((Date.parse(a["forge-dev/expires"]) - Date.now()) / 60000);
  const commit = s?.commit ? git(["log", "-1", "--format=%h %s", s.commit], { check: false, quiet: true }) || s.commit.slice(0, 11) : "";
  return `${pod.metadata.name}  ${a["forge-dev/branch"]}  ${s ? s.state + (s.detail ? ` (${s.detail})` : "") : pod.status.phase}\n` +
    `  ${commit}\n  UI http://127.0.0.1:${ui}/   ${left} min left`;
}

const resolveName = () => positional[0] ?? podName(opt("branch", currentBranch()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
  const branch = opt("branch", currentBranch());
  const ttl = parseTtl(opt("ttl", "4h"));
  const tag = setup();
  push(branch);
  const name = podName(branch);
  if (getPod(name)) kubectl(["delete", "pod", name, "--wait=true"]);
  const { image, sha } = tableImage();
  // The base commit has to be in the mirror for the pod to diff against it.
  run("git", ["push", "-q", "-f", "dev", `${sha}:refs/heads/dev-base/${sha.slice(0, 11)}`]);
  const [ui, http, control] = await pickPorts(listPods());
  const expires = new Date(Date.now() + ttl * 1000).toISOString();
  const pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      namespace: NS,
      labels: { app: "forge-dev", "forge-dev/branch": slug(branch) },
      annotations: { "forge-dev/branch": branch, "forge-dev/expires": expires, "forge-dev/ports": `${ui},${http},${control}`, "forge-dev/base": image },
    },
    spec: {
      activeDeadlineSeconds: ttl,
      restartPolicy: "Never",
      automountServiceAccountToken: false,
      securityContext: { runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, runAsNonRoot: true },
      initContainers: [
        { name: "base", image, imagePullPolicy: "Never", command: ["sh", "-c", "cp /opt/forge/forge-web.jar /base/"],
          volumeMounts: [{ name: "base", mountPath: "/base" }] },
      ],
      containers: [
        {
          name: "dev",
          image: tag,
          imagePullPolicy: "Never",
          command: ["devpod"],
          env: [{ name: "BRANCH", value: branch }, { name: "BASE_SHA", value: sha }],
          ports: [{ name: "ui", containerPort: 5173 }, { name: "http", containerPort: 7777 }],
          readinessProbe: { exec: { command: ["grep", "-q", '"state":"running"', "/work/status.json"] }, periodSeconds: 2 },
          resources: { requests: { cpu: "250m", memory: "1536Mi" }, limits: { cpu: "4", memory: "4Gi" } },
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
          volumeMounts: [
            { name: "git", mountPath: "/git", readOnly: true },
            { name: "npm", mountPath: "/npm-cache" },
            { name: "pics", mountPath: "/pics", readOnly: true },
            { name: "base", mountPath: "/base" },
            { name: "work", mountPath: "/work" },
          ],
        },
      ],
      volumes: [
        { name: "git", hostPath: { path: "/data/forge-dev/git" } },
        { name: "npm", hostPath: { path: "/data/forge-dev/npm" } },
        { name: "pics", hostPath: { path: "/tmp/hostpath-provisioner/forge/forge-pics" } },
        { name: "base", emptyDir: {} },
        { name: "work", emptyDir: {} },
      ],
    },
  };
  const t0 = Date.now();
  kubectl(["apply", "-f", "-"], { input: JSON.stringify(pod) });
  git(["config", `branch.${branch}.devpod`, name]);
  kubectl(["wait", "--for=condition=Ready", `pod/${name}`, "--timeout=600s"]);
  console.log(`ready in ${Math.round((Date.now() - t0) / 1000)} s`);
  forward(getPod(name));
  await sleep(1500);
  console.log(describe(getPod(name)));
  console.log(`  game: node tools/dev.mjs game ${name}   (or start.mjs --port ${http} --control-port ${control} --ui http://127.0.0.1:${ui}/)`);
}

async function main() {
  switch (cmd) {
    case "setup":
      console.log(`dev image ${setup()}`);
      break;
    case "up":
      await up();
      break;
    case "push":
      push(opt("branch", currentBranch()));
      break;
    case "push-bg": {
      // From the post-commit hook: push without making the commit wait, and with no window.
      const branch = positional[0];
      const log = join(git(["rev-parse", "--absolute-git-dir"]), "dev-push.log");
      const script = `git push -q -f dev "refs/heads/${branch}:refs/heads/${branch}" && echo "pushed $(git rev-parse --short HEAD) $(date +%T)"`;
      const out = openSync(log, "w");
      spawn("sh", ["-c", script], { detached: true, stdio: ["ignore", out, out], windowsHide: true }).unref();
      break;
    }
    case "ls": {
      const pods = listPods();
      console.log(pods.length ? pods.map(describe).join("\n") : "no dev pods");
      break;
    }
    case "status": {
      const pod = getPod(resolveName());
      console.log(pod ? describe(pod) : "no such pod");
      break;
    }
    case "logs": {
      const which = positional.find((a) => ["dev", "build", "server", "vite"].includes(a)) ?? "dev";
      const name = positional.find((a) => a.startsWith("dev-")) ?? podName(opt("branch", currentBranch()));
      const lines = opt("lines", "60");
      const r = which === "dev"
        ? kubectl(["logs", name, "-c", "dev", `--tail=${lines}`], { check: false })
        : kubectl(["exec", name, "-c", "dev", "--", "tail", "-n", lines, `/work/${which}.log`], { check: false });
      process.stdout.write(r.stdout || r.stderr);
      break;
    }
    case "forward":
      forward(getPod(resolveName()));
      break;
    case "game": {
      const name = positional[0]?.startsWith("dev-") ? positional[0] : podName(currentBranch());
      const [ui, http, control] = ports(getPod(name));
      const rest = args.slice(1).filter((a) => a !== name);
      const r = spawnSync("node", [join(here, "start.mjs"), "--port", String(http), "--control-port", String(control),
        "--ui", `http://127.0.0.1:${ui}/`, ...rest], { stdio: "inherit", windowsHide: true });
      process.exit(r.status ?? 1);
    }
    case "down": {
      const names = flag("all") ? listPods().map((p) => p.metadata.name) : [resolveName()];
      const byName = new Map(listPods().map((p) => [p.metadata.name, p.metadata.annotations?.["forge-dev/branch"]]));
      for (const n of names) {
        unforward(n);
        kubectl(["delete", "pod", n, "--wait=false", "--ignore-not-found"]);
        // The branch's commits stop going to the mirror.
        const branch = byName.get(n);
        if (branch) run("git", ["config", "--unset", `branch.${branch}.devpod`], { check: false });
      }
      console.log(`deleted ${names.join(", ") || "nothing"}`);
      break;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 12).join("\n"));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
