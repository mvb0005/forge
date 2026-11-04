// Auto-passing (docs/AUTOPASS.md, M14.1) with two human seats on tools/states/autopass.txt: Ann (active, four Shocks)
// and Ben (two Shocks, so he always has something to do and Forge never passes for him on its own).
// usage: node tools/autopass.mjs [--port 7777] [--control-port 7790] [--verbose]
// 1. Ann casts a Shock at Ben: she isn't asked again with her own spell on top; Ben is.
// 2. Ben passes "until the stack resolves": the Shock resolves and the yield ends with no "stopped".
// 3. Ben passes "until Ann's end step". Ann Shocks herself: Ben isn't asked. Ann Shocks Ben: Ben's yield stops,
//    saying why and pointing at the Shock, and he is asked.
// 4. Ben passes "until Ann's end step" again; Ann passes her turn on: Ben is next asked at Ann's end step.
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const port = Number(opt("port", 7777));
const controlPort = Number(opt("control-port", 7790));
const verbose = args.includes("--verbose");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch(`http://127.0.0.1:${controlPort}/match`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ version: 1, state: "autopass.txt", seats: [{ kind: "human", name: "Ann" }, { kind: "human", name: "Ben" }] }),
});
const started = await res.json();
if (res.status !== 201) {
  console.log("POST /match refused:", started.error);
  process.exit(1);
}

function client(name, ticket) {
  const c = { name, msgs: [], players: new Map(), cards: new Map(), stack: [], game: null, prompt: "", buttons: null, selPlayers: [], auto: null, caps: [] };
  c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`);
  c.send = (o) => {
    if (verbose) console.log(`${name} >>`, JSON.stringify(o));
    c.ws.send(JSON.stringify(o));
  };
  c.ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    m.at = Date.now();
    c.msgs.push(m);
    if (verbose && m.t !== "state") console.log(`${name} <<`, JSON.stringify(m).slice(0, 220));
    switch (m.t) {
      case "hello": c.caps = m.caps ?? []; break;
      case "state":
        if (m.game) c.game = m.game;
        for (const p of m.players ?? []) c.players.set(p.id, p);
        for (const x of m.cards ?? []) c.cards.set(x.id, x);
        for (const id of m.removedCards ?? []) c.cards.delete(id);
        if (m.stack) c.stack = m.stack;
        break;
      case "prompt": c.prompt = m.message; break;
      case "buttons": c.buttons = m; break;
      case "selectables": c.selPlayers = m.playerIds ?? []; break;
      case "autopass": c.auto = m; break;
      case "ask": {
        const value = m.kind === "confirm" || m.kind === "option" ? m.defaultIndex : null;
        c.send({ t: "answer", id: m.id, value });
        break;
      }
    }
  };
  return c;
}

const [annSeat, benSeat] = started.seats.filter((s) => s.ticket);
const ann = client("Ann", annSeat.ticket);
const ben = client("Ben", benSeat.ticket);
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};
async function until(what, cond, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(50);
  }
  console.log(`  timed out waiting for: ${what} (Ann: "${ann.prompt}", Ben: "${ben.prompt}")`);
  return false;
}
const mine = (c) => c.buttons?.ok.enabled && c.prompt.startsWith("Priority:");
const idOf = (c, who) => [...c.players.values()].find((p) => p.name === who)?.id;
const lifeOf = (c, who) => [...c.players.values()].find((p) => p.name === who)?.life;
const asked = (c, from) => c.msgs.slice(from).some((m) => m.t === "buttons" && m.ok.enabled);

const openEnd = Date.now() + 30000;
while (Date.now() < openEnd && !(mine(ann) && ann.game?.phase === "MAIN1")) {
  for (const c of [ann, ben]) {
    const annId = idOf(c, "Ann");
    if (/Who would you like to start/.test(c.prompt) && annId != null) c.send({ t: "selectPlayer", playerId: annId, shift: false, button: 1 });
    else if (c.buttons?.ok.enabled && !c.prompt.startsWith("Priority:")) c.send({ t: "ok" });
  }
  await sleep(300);
}
check(ann.caps.includes("autopass"), "the server has the autopass cap");
check(mine(ann) && ann.game?.phase === "MAIN1", "Ann has priority in her main phase");

async function castShock(at) {
  const shock = [...ann.cards.values()].find((x) => x.zone === "hand" && x.name === "Shock" && x.controllerId === idOf(ann, "Ann"));
  const target = idOf(ann, at);
  const before = ann.stack.length;
  ann.send({ t: "selectCard", cardId: shock.id, shift: false, button: 1 });
  await until("Ann to be asked for a target", () => ann.selPlayers.includes(target) || ann.stack.length > before, 5000);
  if (ann.selPlayers.includes(target)) ann.send({ t: "selectPlayer", playerId: target, shift: false, button: 1 });
  for (let i = 0; i < 10 && ann.stack.length === before; i++) {
    await sleep(300);
    if (ann.stack.length !== before || !/Pay Mana Cost/.test(ann.prompt)) continue;
    const land = [...ann.cards.values()].find((x) => x.zone === "battlefield" && x.name === "Mountain" && !x.tapped && x.controllerId === idOf(ann, "Ann"));
    if (land) ann.send({ t: "selectCard", cardId: land.id, shift: false, button: 1 });
  }
  return until("the Shock on the stack", () => ann.stack.length === before + 1);
}

// 1. Your own spell on top passes.
let annFrom = ann.msgs.length;
await castShock("Ben");
await until("Ben's priority", () => mine(ben) && ben.stack.length === 1);
check(mine(ben) && ben.stack.length === 1, "1. Ben is asked with Ann's Shock on the stack");
const annAskedOnOwn = ann.msgs.slice(annFrom).some((m) => m.t === "prompt" && /Stack: 1 to Resolve/.test(m.message));
check(!annAskedOnOwn, "1. Ann was not asked again with her own Shock on top");

// 2. Until the stack resolves.
let benFrom = ben.msgs.length;
const benLife = lifeOf(ben, "Ben");
ben.send({ t: "yield", kind: "stack" });
await until("the Shock to resolve", () => lifeOf(ben, "Ben") === benLife - 2);
const autos2 = ben.msgs.slice(benFrom).filter((m) => m.t === "autopass");
check(autos2.some((m) => m.yield?.kind === "stack"), "2. Ben's stack yield started");
await until("the stack yield to end", () => ben.auto && ben.auto.yield === null);
check(ben.auto?.yield === null && !ben.auto.stopped, `2. it ended at an empty stack with no "stopped" (${JSON.stringify(ben.auto)})`);

// 3. Until Ann's end step: not stopped by a spell that doesn't touch Ben, stopped by one that does.
await until("Ann's priority", () => mine(ann) && ann.stack.length === 0);
ben.send({ t: "yield", kind: "endStep", playerId: idOf(ben, "Ann") });
await until("Ben's yield", () => ben.auto?.yield?.kind === "endStep");
check(ben.auto?.yield?.label === "Passing until Ann's end step", `3. Ben's yield: "${ben.auto?.yield?.label}"`);
benFrom = ben.msgs.length;
const annLife = lifeOf(ann, "Ann");
await castShock("Ann");
await until("Ann's Shock at herself to resolve", () => lifeOf(ann, "Ann") === annLife - 2);
check(lifeOf(ann, "Ann") === annLife - 2, "3. Ann's Shock at herself resolved");
check(!asked(ben, benFrom) && ben.auto?.yield?.kind === "endStep", "3. Ben wasn't asked and still yields (no interrupt for a spell that doesn't target him)");
await until("Ann's priority", () => mine(ann) && ann.stack.length === 0);
benFrom = ben.msgs.length;
await castShock("Ben");
await until("Ben's yield to stop", () => ben.auto?.yield === null);
check(/Ann cast Shock targeting you/.test(ben.auto?.stopped ?? ""), `3. Ben's yield stopped: "${ben.auto?.stopped}"`);
check(ben.auto?.stackId != null && ben.auto.stackId === ben.stack[0]?.id, "3. it points at the Shock");
await until("Ben's priority", () => mine(ben));
check(mine(ben) && ben.stack.length === 1, "3. Ben is asked, with the Shock to answer");
ben.send({ t: "ok" });

// 4. Reaching Ann's end step.
await until("Ann's priority", () => mine(ann) && ann.stack.length === 0);
ben.send({ t: "yield", kind: "endStep", playerId: idOf(ben, "Ann") });
await until("Ben's yield", () => ben.auto?.yield?.kind === "endStep");
benFrom = ben.msgs.length;
for (let i = 0; i < 20 && !(mine(ben) && ben.game?.phase === "END_OF_TURN"); i++) {
  if (mine(ann)) ann.send({ t: "ok" });
  await sleep(400);
}
check(mine(ben) && ben.game?.phase === "END_OF_TURN", `4. Ben is next asked at Ann's end step (${ben.game?.phase})`);
check(ben.auto?.yield === null && !ben.auto.stopped, "4. the yield ended there, with no \"stopped\"");
const benPromptsOnTheWay = ben.msgs.slice(benFrom).filter((m) => m.t === "buttons" && m.ok.enabled).length;
check(benPromptsOnTheWay === 1, `4. one prompt for Ben on the way (${benPromptsOnTheWay})`);
ben.send({ t: "ok" });

await sleep(500);
check(!ann.msgs.some((m) => m.t === "autopass" && m.yield), "Ann was sent nothing about Ben's yields");
console.log(failures ? `${failures} FAILED` : "all passed");
await fetch(`http://127.0.0.1:${controlPort}/match/${started.matchId}`, { method: "DELETE" }).catch(() => {});
ann.ws.close();
ben.ws.close();
process.exit(failures ? 1 : 0);
