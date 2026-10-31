// Starts a match on a local game server through the control API, the way mtg-tracker does, and prints each
// human seat's table link. For development without the tracker.
// usage: node tools/start.mjs [--port 7777] [--control-port 7790] [--format commander|constructed]
//                             [--deck cmdr:randomprecon | random:RG | FILE.txt in tools/decks] [--curated neyali,jeleva]
//                             [--opp cmdr:randomprecon] [--opponents 3] [--humans 1] [--state token-pod-turn12.txt]
//                             [--ui http://127.0.0.1:5173/]   the page to open (default: the server's own /play/table/)
// FORGE_CONTROL_SECRET is sent when set.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const port = Number(opt("port", 7777));
const controlPort = Number(opt("control-port", 7790));
const format = opt("format", "commander");
const commander = format === "commander";
const deckArg = opt("deck", commander ? "cmdr:randomprecon" : "random:RG");
const opp = opt("opp", commander ? "cmdr:randomprecon" : "random:UB");
const curated = opt("curated", null);
const humans = Number(opt("humans", 1));
const opponents = curated ? curated.split(",").length : Number(opt("opponents", commander ? 3 : 1));
const state = opt("state", null);
const ui = opt("ui", `http://127.0.0.1:${port}/play/table/`);

const deck = deckArg.endsWith(".txt")
  ? { name: deckArg.replace(/\.txt$/, ""), list: readFileSync(new URL(`./decks/${deckArg}`, import.meta.url), "utf8") }
  : { id: deckArg };
const seats = [
  ...Array.from({ length: humans }, (_, i) => ({ kind: "human", name: humans > 1 ? `Player ${i + 1}` : "You", deck })),
  ...(curated ? curated.split(",").map((id) => ({ kind: "ai", opponent: id })) : Array.from({ length: opponents }, () => ({ kind: "ai", deck: { id: opp } }))),
];
const spec = state ? { version: 1, state } : { version: 1, format, seats };

const secret = process.env.FORGE_CONTROL_SECRET;
const res = await fetch(`http://127.0.0.1:${controlPort}/match`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
  body: JSON.stringify(spec),
});
const body = await res.json();
if (res.status !== 201) {
  console.error(`Refused (${res.status}): ${body.error}`);
  process.exit(1);
}
console.log(`Match ${body.matchId}`);
for (const s of body.seats) {
  console.log(s.ticket ? `  ${s.name}: ${ui}?ticket=${s.ticket}` : `  ${s.name} (AI)`);
}
