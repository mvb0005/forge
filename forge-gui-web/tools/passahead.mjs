// Passing ahead (M12.1) with two human seats on tools/states/pass-ahead.txt: Ann (active, three Shocks) and Ben.
// Ann keeps a spare Shock so she still has something to do (Forge passes for a player who has nothing).
// usage: node tools/passahead.mjs [--port 7777] [--control-port 7790] [--verbose] [--three]
// --three: pass-ahead-3.txt, an AI seated between Ann and Ben (priority walks past it); runs 1 and 5.
// 1. Ann casts a Shock at Ben; Ben passes ahead; Ann passes: Ben's pass is used at once (no timer) and it resolves.
// 2. Ann casts another; Ben passes ahead; Ann casts a third in response: Ben is told his pass was cancelled, naming it,
//    with the new stack item's id.
// 3. Ben passes ahead again with the old round: refused.
// 4. Ben waits 8 s while Ann holds priority, then Ann passes: Ben still gets his own 10 s (waiting doesn't run it).
// 5. Ann is never sent anything about Ben's pass.
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const port = Number(opt("port", 7777));
const controlPort = Number(opt("control-port", 7790));
const verbose = args.includes("--verbose");
const three = args.includes("--three");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch(`http://127.0.0.1:${controlPort}/match`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(three
    ? { version: 1, state: "pass-ahead-3.txt", seats: [{ kind: "human", name: "Ann" }, { kind: "ai", name: "Cal" }, { kind: "human", name: "Ben" }] }
    : { version: 1, state: "pass-ahead.txt", seats: [{ kind: "human", name: "Ann" }, { kind: "human", name: "Ben" }] }),
});
const started = await res.json();
if (res.status !== 201) {
  console.log("POST /match refused:", started.error);
  process.exit(1);
}

function client(name, ticket) {
  const c = { name, msgs: [], players: new Map(), cards: new Map(), stack: [], game: null, prompt: "", buttons: null, selPlayers: [], ahead: null, timer: null };
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
      case "ahead": c.ahead = m; break;
      case "timer": c.timer = m.seconds; break;
      case "ask": {
        // the opening questions (play or draw, keep): take the default
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
// Ann responds to her own Shocks, so she holds priority after her spells (the server passes there otherwise: autopass).
ann.ws.addEventListener("message", (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.t === "hello" && m.caps?.includes("autopass")) ann.send({ t: "holdPriority", on: true });
});
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
const lifeOf = (c, who) => [...c.players.values()].find((p) => p.name === who)?.life;
const benId = () => [...ann.players.values()].find((p) => p.name === "Ben")?.id;

// Opening: keep / play prompts go to whoever is asked; answer OK until Ann has priority in her main phase.
const openEnd = Date.now() + 30000;
while (Date.now() < openEnd && !(mine(ann) && ann.game?.phase === "MAIN1")) {
  for (const c of [ann, ben]) {
    const annId = [...c.players.values()].find((p) => p.name === "Ann")?.id;
    if (/Who would you like to start/.test(c.prompt) && annId != null) c.send({ t: "selectPlayer", playerId: annId, shift: false, button: 1 });
    else if (c.buttons?.ok.enabled && !c.prompt.startsWith("Priority:")) c.send({ t: "ok" });
  }
  await sleep(300);
}
check(mine(ann) && ann.game?.phase === "MAIN1", "Ann has priority in her main phase");

async function castShock() {
  const shock = [...ann.cards.values()].find((x) => x.zone === "hand" && x.name === "Shock" && x.controllerId !== benId());
  const before = ann.stack.length;
  ann.send({ t: "selectCard", cardId: shock.id, shift: false, button: 1 });
  await until("Ann to be asked for a target", () => ann.selPlayers.includes(benId()) || ann.stack.length > before, 5000);
  if (ann.selPlayers.includes(benId())) ann.send({ t: "selectPlayer", playerId: benId(), shift: false, button: 1 });
  // pay: tap one of Ann's untapped Mountains
  for (let i = 0; i < 10 && ann.stack.length === before; i++) {
    await sleep(300);
    if (ann.stack.length !== before || !/Pay Mana Cost/.test(ann.prompt)) continue;
    const land = [...ann.cards.values()].find((x) => x.zone === "battlefield" && x.name === "Mountain" && !x.tapped && x.controllerId !== benId());
    if (land) ann.send({ t: "selectCard", cardId: land.id, shift: false, button: 1 });
  }
  return until("the Shock on the stack and Ann's priority back", () => ann.stack.length === before + 1 && mine(ann));
}

// 1. A pass ahead is used the moment priority reaches Ben.
await castShock();
await until("Ben may pass ahead", () => ben.ahead?.open);
check(ben.ahead?.open === true, "1. Ben may pass ahead while Ann holds priority with a Shock on the stack");
ben.send({ t: "passAhead", round: ben.ahead.round });
await until("Ben's pass to be recorded", () => ben.ahead?.passed);
check(ben.ahead?.passed === true, "1. Ben's pass ahead is recorded");
const benLife = lifeOf(ben, "Ben");
const passAt = Date.now();
const benMsgsBefore = ben.msgs.length;
ann.send({ t: "ok" });
await until("the Shock to resolve", () => lifeOf(ben, "Ben") === benLife - 2);
check(lifeOf(ben, "Ben") === benLife - 2, `1. the Shock resolved ${Date.now() - passAt} ms after Ann passed (Ben not asked)`);
check(!ben.msgs.slice(benMsgsBefore).some((m) => m.t === "timer" && m.seconds), "1. Ben was never timed");

if (three) {
  await sleep(1000);
  await finish();
}

// 2. Something new on the stack cancels it, and Ben is told what.
await until("Ann's priority", () => mine(ann));
await castShock();
await until("Ben may pass ahead", () => ben.ahead?.open);
const oldRound = ben.ahead.round;
ben.send({ t: "passAhead", round: oldRound });
await until("Ben's pass", () => ben.ahead?.passed);

// 2a. Backing out of a cast ends the round too (the engine asks Ann again, and can't say why), but Ben's notice
//     claims nothing that didn't happen.
const backOut = [...ann.cards.values()].find((x) => x.zone === "hand" && x.name === "Shock" && x.controllerId !== benId());
const noticesBack = ben.msgs.filter((m) => m.t === "notice").length;
ann.send({ t: "selectCard", cardId: backOut.id, shift: false, button: 1 });
await until("Ann to be asked for a target", () => ann.selPlayers.includes(benId()), 5000);
ann.send({ t: "cancel" });
await until("Ben's notice", () => ben.msgs.filter((m) => m.t === "notice").length > noticesBack);
const backNotice = ben.msgs.filter((m) => m.t === "notice").at(-1);
check(/Ann kept priority/.test(backNotice?.message ?? "") && !/cast|took an action/.test(backNotice?.message ?? ""), `2a. after Ann backs out Ben is told: "${backNotice?.message}"`);
await until("Ann's priority back", () => mine(ann));
await until("Ben may pass ahead again", () => ben.ahead?.open && !ben.ahead.passed);
ben.send({ t: "passAhead", round: ben.ahead.round });
await until("Ben's pass", () => ben.ahead?.passed);

const noticesBefore = ben.msgs.filter((m) => m.t === "notice").length;
await castShock();
const newTop = ann.stack[0]?.id;
await until("Ben's cancelled notice", () => ben.msgs.filter((m) => m.t === "notice").length > noticesBefore);
const cancelled = ben.msgs.filter((m) => m.t === "notice").at(-1);
check(cancelled?.title === "Pass cancelled" && /Ann cast Shock/.test(cancelled?.message ?? ""), `2. Ben is told: "${cancelled?.message}"`);
check(cancelled?.stackId != null && cancelled.stackId === newTop, "2. the notice names the new stack item");
check(ben.ahead?.passed === false && ben.ahead?.round !== oldRound, "2. Ben's pass is gone, in a new round");

// 3. A pass for a round that's over is refused.
ben.send({ t: "passAhead", round: oldRound });
await sleep(500);
check(ben.ahead?.passed === false, "3. a pass ahead with an old round is refused");

// 4. Waiting doesn't run Ben's clock.
await sleep(8000); // inside Ann's own 10 s (she is responding too: a Shock is on the stack)
const benMsgs4 = ben.msgs.length;
ann.send({ t: "ok" });
await until("Ben's priority", () => mine(ben));
const timer4 = ben.msgs.slice(benMsgs4).find((m) => m.t === "timer");
check(mine(ben) && timer4?.seconds === 10, `4. after waiting 8 s Ben has priority with ${timer4?.seconds ?? "no"} s on his timer`);
ben.send({ t: "ok" });

// 5. Ann hears nothing of it.
await sleep(1000);
await finish();

async function finish() {
check(!ann.msgs.some((m) => (m.t === "ahead" && m.passed) || (m.t === "notice" && m.title === "Pass cancelled")), "5. Ann was sent nothing about Ben's pass");

console.log(failures ? `${failures} FAILED` : "all passed");
await fetch(`http://127.0.0.1:${controlPort}/match/${started.matchId}`, { method: "DELETE" }).catch(() => {});
ann.ws.close();
ben.ws.close();
process.exit(failures ? 1 : 0);
}
