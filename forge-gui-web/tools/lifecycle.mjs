// Checks the control API's match lifecycle against a running game server (PROTOCOL.md "Control API"):
// two human seats, 409 while playing, bad and replaced tickets, ending by id, a fresh match after, old tickets dead.
// usage: node tools/lifecycle.mjs [--port 7777] [--control-port 7790]   (FORGE_CONTROL_SECRET is sent when set)
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt; };
const secret = process.env.FORGE_CONTROL_SECRET;
const C = `http://127.0.0.1:${opt("control-port", 7790)}`, T = `127.0.0.1:${opt("port", 7777)}/play/table/`;
const ctl = async (m, p, b) => {
  const r = await fetch(C + p, { method: m, body: b && JSON.stringify(b), headers: secret ? { Authorization: `Bearer ${secret}` } : {} });
  return [r.status, await r.json()];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (ticket, table = "") => new Promise((res) => {
  const ws = new WebSocket(`ws://${T}${table && `${table}/`}ws?ticket=${ticket}`); const got = []; let closed = null;
  ws.onmessage = (e) => got.push(JSON.parse(e.data).t);
  ws.onclose = (e) => { closed = [e.code, e.reason]; };
  setTimeout(() => res({ ws, got, get closed() { return closed; } }), 2500);
});
let fail = 0; const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fail++; };
const spec = (humans) => ({ version: 1, format: "commander", seats: [
  ...Array.from({ length: humans }, (_, i) => ({ kind: "human", name: "Same", person: String(i + 1), deck: { id: "cmdr:randomprecon" } })),
  { kind: "ai", opponent: "neyali" }, { kind: "ai", opponent: "jeleva" }] });

let [st, a] = await ctl("POST", "/match", spec(2));
check(st === 201 && a.seats.filter((s) => s.ticket).length === 2, `two-human match starts (${st})`);
check(new Set(a.seats.map((s) => s.name)).size === 4, `seat names unique: ${a.seats.map((s) => s.name).join(", ")}`);
[st] = await ctl("POST", "/match", spec(1));
check(st === 409, `second start while playing is refused (${st})`);
const bad = await open("0".repeat(32));
check(bad.closed && bad.closed[0] === 4004, `bad ticket closed with ${bad.closed}`);
const [t1, t2] = a.seats.filter((s) => s.ticket).map((s) => s.ticket);
const one = await open(t1), two = await open(t2);
check(one.got.includes("hello") && one.got.includes("state"), `seat 1 gets hello and state (${[...new Set(one.got)]})`);
check(two.got.includes("hello") && two.got.includes("state"), `seat 2 gets hello and state (${[...new Set(two.got)]})`);
let [, s1] = await ctl("GET", "/match");
check(s1.seats.filter((s) => s.connected).length === 2, `status shows both humans connected`);
const again = await open(t1);
check(one.closed && one.closed[0] === 4001, `same ticket again replaces the first window (${one.closed})`);
const byId = await open(t2, a.matchId);
check(byId.got.includes("state") && two.closed && two.closed[0] === 4001, `seat 2 again at /play/table/<id>/ replaces its window (${two.closed})`);
const wrongId = await open(t2, "deadbeefdeadbeef");
check(wrongId.closed && wrongId.closed[0] === 4004, `a ticket at another match's path is refused (${wrongId.closed})`);
const bare = await fetch(`http://${T}${a.matchId}`, { redirect: "manual" });
check(bare.status === 302 && bare.headers.get("location") === `/play/table/${a.matchId}/`, `the bare id path redirects (${bare.status} ${bare.headers.get("location")})`);
const page = await fetch(`http://${T}${a.matchId}/`);
check(page.status === 200 && (await page.text()).includes("<div id=\"root\""), `the page is served under the id (${page.status})`);
[st] = await ctl("DELETE", "/match/deadbeefdeadbeef");
check(st === 404, `ending a different match id is refused (${st})`);
[st] = await ctl("DELETE", `/match/${a.matchId}`);
check(st === 202, `ending the match (${st})`);
let end; for (let i = 0; i < 40; i++) { await sleep(500); [, end] = await ctl("GET", "/match"); if (end.state === "finished") break; }
check(end.state === "finished" && end.result.status === "ended", `match ended: ${end.state} ${end.result && end.result.status}`);
const late = await open(t2, a.matchId);
check(late.got.includes("ended") || byId.got.includes("gameOver"), `a seat sees the end (${[...new Set(late.got)]})`);
[st, a] = await ctl("POST", "/match", spec(1));
check(st === 201, `a fresh match starts after ending (${st})`);
const fresh = await open(a.seats.find((s) => s.ticket).ticket);
check(fresh.got.includes("state"), `fresh match sends state`);
const old = await open(t1);
check(old.closed && old.closed[0] === 4004, `old match's ticket no longer works (${old.closed})`);
await ctl("DELETE", `/match/${a.matchId}`);
for (const w of [byId.ws, again.ws, late.ws, fresh.ws]) try { w.close(); } catch {}
console.log(fail ? `${fail} FAILED` : "all ok");
process.exit(fail ? 1 : 0);
