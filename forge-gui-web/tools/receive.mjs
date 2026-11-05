// Stands in for mtg-tracker's /play/replays and /play/results for a local game server: keeps every POST as a file.
// usage: node tools/receive.mjs [--port 7799] [--dir replays]
// then start matches with replayUrl http://127.0.0.1:7799/replays (smoke.mjs and start.mjs: --replay-url).
// A replay POSTed to /replays/<match> is saved as <dir>/<match>.jsonl.gz.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const port = Number(opt("port", 7799));
const dir = opt("dir", "replays");
mkdirSync(dir, { recursive: true });

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const name = req.url.split("/").filter(Boolean).slice(1).join("-") || "post";
    const gz = body[0] === 0x1f && body[1] === 0x8b;
    const file = join(dir, gz ? `${name}.jsonl.gz` : `${name}.json`);
    writeFileSync(file, body);
    console.log(`${req.method} ${req.url}: ${body.length} B -> ${file}`);
    res.writeHead(204).end();
  });
}).listen(port, "127.0.0.1", () => console.log(`receiving on http://127.0.0.1:${port}/ into ${dir}`));
