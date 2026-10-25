// Smoke test for the Forge web bridge: plays a whole game against the AI with default answers.
// usage: node tools/smoke.mjs [--port 7777] [--deck random:RG] [--opp random:UB] [--opponents 1]
//                             [--state token-pod-turn12.txt] [--seconds 600] [--turns N] [--verbose] [--passive]
// Policy: answer asks with a valid default; in our main phases with OK enabled, first try each playable
// card once (lands first) unless --passive, then OK; otherwise click a selectable (Cancel after 5 repeats
// of the same prompt); otherwise a selectable player; otherwise Cancel; with nothing enabled at all, click our
// own player. While declaring blockers it first assigns one legal block from the `blockers` assist and checks
// that the combat assist follows it.
// Checks (protocol v2): hello version and caps, the log arrives append-only, `blockers` assists are sane (and match
// the expectations below for the blockers-*.txt fixtures), and reports the largest state message for a one-card change.
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const port = Number(opt("port", 7777));
const deck = opt("deck", "random:RG");
const opp = opt("opp", "random:UB");
const opponents = Number(opt("opponents", 1));
const stateFile = opt("state", null);
const seconds = Number(opt("seconds", stateFile ? 900 : 600));
const maxTurns = Number(opt("turns", 0));
const verbose = flag("verbose");
const passive = flag("passive");

// fixture -> attacker name -> expected blockers assist entry, by card name
const BLOCKER_EXPECT = {
  "blockers-evasion.txt": {
    "Serra Angel": { min: 1, can: ["Giant Spider", "Wind Drake"], cannot: { "Hill Giant": "Flying: needs flying or reach", "Sightless Ghoul": "Can't block" } },
    "Boggart Brute": { min: 2, can: ["Giant Spider", "Wind Drake", "Hill Giant"], cannot: { "Sightless Ghoul": "Can't block" } },
    "Grizzly Bears": { min: 1, can: ["Giant Spider", "Wind Drake", "Hill Giant"], cannot: { "Sightless Ghoul": "Can't block" } },
  },
  "blockers-menace.txt": {
    "Boggart Brute": { min: 2, can: [], cannot: { "Hill Giant": "Menace: needs a second blocker", "Sightless Ghoul": "Can't block" } },
  },
};

// fixture -> the player ids a players-only selectables must offer ("me" = our seat)
const PLAYER_TARGET_EXPECT = { "targets-hexproof.txt": ["me", 2] }; // p1 has hexproof (Leyline of Sanctity)
let playerTargetSeen = false;

const counts = {};
const askKinds = {};
let maxState = 0, stateBytes = 0, states = 0, errors = 0, idProblems = 0, seqProblems = 0;
let lastSeq = 0, started = false, gameOver = null, actions = 0;
const cards = new Map(), players = new Map();
let game = null, buttons = null, prompt = null, selectables = [], inputDirty = false, lastMsgAt = Date.now();
let lastStateAt = Date.now(), samePrompt = 0, lastPromptText = "", flashes = 0;
let playable = [], tried = new Set(), triedKey = "";
let selectablePlayers = [];
const highlighted = new Set();
let log = [], logProblems = 0, logAppends = 0;
let cardOnlyMax = 0, oneCardV1Max = 0, oneCardMax = 0, oneCardCount = 0, oneCardOver = 0;
let blockers = null, blockersSeen = 0, blockersProblems = 0, blockTurn = -1, pendingBlock = null, lastBlock = null, blockDone = null, blockFollowed = 0;
let combatAssists = 0, expectChecked = 0;
const problem = (what) => {
  blockersProblems++;
  if (blockersProblems <= 20) console.log("BLOCKERS:", what);
};
const nameOf = (id) => (cards.get(id) ? cards.get(id).name : `#${id}`);
const sameJson = (a, b) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());

function checkBlockers(b) {
  if (!b) return;
  const me = game ? game.localPlayerIds[0] : null;
  for (const e of b.attackers) {
    if (!cards.get(e.attackerId)) problem(`unknown attacker ${e.attackerId}`);
    if (!(e.minBlockers >= 1)) problem(`bad minBlockers ${e.minBlockers}`);
    const can = new Set(e.canBlock);
    for (const id of e.canBlock) {
      const c = cards.get(id);
      if (!c) problem(`unknown blocker ${id}`);
      else if (c.controllerId !== me || c.zone !== "battlefield") problem(`${c.name} is not our creature on the battlefield`);
    }
    for (const x of e.cannotBlock) {
      if (can.has(x.id)) problem(`${nameOf(x.id)} both can and cannot block ${nameOf(e.attackerId)}`);
      if (!x.reason) problem(`no reason for ${nameOf(x.id)}`);
      if (!cards.get(x.id)) problem(`unknown creature ${x.id}`);
    }
  }
  const expect = stateFile && BLOCKER_EXPECT[stateFile];
  if (expect && !expectChecked) {
    expectChecked++;
    const before = blockersProblems;
    for (const [attacker, want] of Object.entries(expect)) {
      const e = b.attackers.find((x) => nameOf(x.attackerId) === attacker);
      if (!e) { problem(`no entry for ${attacker}`); continue; }
      const can = e.canBlock.map(nameOf).sort();
      if (JSON.stringify(can) !== JSON.stringify([...want.can].sort())) problem(`${attacker}: canBlock ${can} != ${want.can}`);
      if (e.minBlockers !== want.min) problem(`${attacker}: minBlockers ${e.minBlockers} != ${want.min}`);
      const cannot = Object.fromEntries(e.cannotBlock.map((x) => [nameOf(x.id), x.reason]));
      if (!sameJson(cannot, want.cannot)) problem(`${attacker}: cannotBlock ${JSON.stringify(cannot)} != ${JSON.stringify(want.cannot)}`);
    }
    console.log(`fixture ${stateFile}: blockers assist ${blockersProblems > before ? "MISMATCH" : "as expected"}`);
  }
  if (blockDone) {
    // after our block: the blocker stays listed as able to block its attacker
    const e = b.attackers.find((x) => x.attackerId === blockDone.attackerId);
    if (e && !e.canBlock.includes(blockDone.blockerId)) problem(`${nameOf(blockDone.blockerId)} blocks ${nameOf(blockDone.attackerId)} but isn't in its canBlock`);
  }
}
const t0 = Date.now();

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
const send = (o) => {
  if (verbose) console.log(">>", JSON.stringify(o).slice(0, 200));
  ws.send(JSON.stringify(o));
};

function known(ref) {
  if (!ref) return true;
  return ref.kind === "card" ? cards.has(ref.id) : players.has(ref.id);
}
function checkIds(what, ids) {
  for (const id of ids) {
    if (id != null && !cards.has(id)) {
      idProblems++;
      if (idProblems <= 10) console.log(`unknown card id ${id} in ${what}`);
    }
  }
}

function answerAsk(a) {
  askKinds[a.kind] = (askKinds[a.kind] || 0) + 1;
  let value;
  switch (a.kind) {
    case "confirm":
    case "option":
      value = a.defaultIndex;
      break;
    case "input":
      value = a.options && a.options.length ? a.options[0] : a.numeric && !a.initial ? "0" : a.initial;
      break;
    case "choose":
    case "order":
      for (const it of a.items) if (!known(it.ref)) { idProblems++; console.log(`unknown ref in ${a.kind}`, it); }
      value = a.items.slice(0, a.min).map((it) => it.i);
      break;
    case "ability": {
      const e = a.items.find((it) => it.enabled);
      value = e ? e.i : null;
      break;
    }
    case "damage": {
      checkIds("damage", [a.attackerId, ...a.blockerIds]);
      const key = a.blockerIds.length ? `card:${a.blockerIds[0]}` : a.defender ? `${a.defender.kind}:${a.defender.id}` : null;
      value = key ? { [key]: a.damage } : null;
      break;
    }
    case "amount": {
      const n = a.items.length;
      value = {};
      a.items.forEach((it, k) => (value[it.i] = Math.floor(a.amount / n) + (k < a.amount % n ? 1 : 0)));
      break;
    }
    case "arrange":
      checkIds("arrange", a.cardIds);
      value = a.cardIds;
      break;
    default:
      console.log("unknown ask kind", a.kind);
      value = null;
  }
  send({ t: "answer", id: a.id, value });
}

function isLand(id) {
  const c = cards.get(id);
  return c && c.types.includes("Land") ? 1 : 0;
}

function act() {
  if (!inputDirty || gameOver || Date.now() - lastMsgAt < 40) return;
  inputDirty = false;
  if (!buttons) return;
  const text = prompt ? prompt.message : "";
  samePrompt = text === lastPromptText ? samePrompt + 1 : 0;
  lastPromptText = text;
  if (samePrompt > 300) {
    console.log("STALL: same prompt 300 times:", text);
    finish(1);
    return;
  }
  actions++;
  const key = game ? `${game.turn}:${game.phase}` : "";
  if (key !== triedKey) {
    triedKey = key;
    tried = new Set();
  }
  const mine = game && game.priorityPlayerId != null && game.localPlayerIds.includes(game.priorityPlayerId);
  const main = game && (game.phase === "MAIN1" || game.phase === "MAIN2");
  const candidates = passive || !mine || !main || selectables.length ? [] : playable.filter((id) => !tried.has(id));
  candidates.sort((a, b) => isLand(b) - isLand(a));
  const blocking = game && game.phase === "COMBAT_DECLARE_BLOCKERS" && blockers && blockers.attackers.length && buttons.ok.enabled;
  if (game && game.phase !== "COMBAT_DECLARE_BLOCKERS") blockDone = null;
  if (blocking && blockTurn !== game.turn) {
    // assign one legal block, then wait for the assist to show it
    blockTurn = game.turn;
    const e = blockers.attackers.find((x) => x.canBlock.length && x.minBlockers === 1);
    if (e) {
      pendingBlock = { attackerId: e.attackerId, blockerId: e.canBlock[0], since: Date.now() };
      lastBlock = pendingBlock;
      send({ t: "selectCard", cardId: e.attackerId, shift: false, button: 1 });
      send({ t: "selectCard", cardId: e.canBlock[0], shift: false, button: 1 });
      return;
    }
  }
  if (blocking && pendingBlock && Date.now() - pendingBlock.since < 3000) {
    inputDirty = true;
    return;
  }
  if (blocking && lastBlock && samePrompt > 5) {
    // the engine rejects the blocks (a lure or the like): take ours back
    send({ t: "selectCard", cardId: lastBlock.blockerId, shift: false, button: 3 });
    lastBlock = null;
    return;
  }
  if (pendingBlock) {
    problem(`combat assist never showed the block of ${nameOf(pendingBlock.attackerId)} by ${nameOf(pendingBlock.blockerId)}`);
    if (verbose || blockersProblems <= 3) console.log("  last blockers assist:", JSON.stringify(blockers), "flashes:", flashes, "combat:", JSON.stringify(game && game.phase), "prompt:", prompt && prompt.message);
    pendingBlock = null;
  }
  if (samePrompt > 5 && samePrompt % 2 === 0 && buttons.ok.enabled && buttons.cancel.enabled) {
    // OK keeps being rejected (a creature must attack, auto-pay can't pay): try the other button too
    send({ t: "cancel" });
  } else if (buttons.ok.enabled && candidates.length) {
    tried.add(candidates[0]);
    send({ t: "selectCard", cardId: candidates[0], shift: false, button: 1 });
    inputDirty = true; // an input may ignore the click silently (e.g. a colour choice): go on with the next one
  } else if (buttons.ok.enabled) {
    send({ t: "ok" });
  } else if (samePrompt > 5 && buttons.cancel.enabled) {
    send({ t: "cancel" });
  } else if (selectables.length) {
    // pick a different one each time we see the same prompt, so a bad choice can't loop forever
    const fresh = selectables.filter((id) => !highlighted.has(`card:${id}`));
    const pool = fresh.length ? fresh : selectables;
    const id = pool[samePrompt % pool.length];
    send({ t: "selectCard", cardId: id, shift: false, button: 1 });
  } else if (selectablePlayers.length) {
    send({ t: "selectPlayer", playerId: selectablePlayers[samePrompt % selectablePlayers.length], shift: false, button: 1 });
  } else if (buttons.cancel.enabled) {
    send({ t: "cancel" });
  } else if (game && game.localPlayerIds.length) {
    // nothing to click but a player (e.g. "who starts?"): pick ourselves
    send({ t: "selectPlayer", playerId: game.localPlayerIds[0], shift: false, button: 1 });
  }
}

ws.onmessage = (ev) => {
  const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    console.log("bad json from server");
    errors++;
    return;
  }
  counts[m.t] = (counts[m.t] || 0) + 1;
  lastMsgAt = Date.now();
  if (verbose && m.t !== "state") console.log("<<", raw.slice(0, 300));
  switch (m.t) {
    case "hello":
      if (m.version !== 2) { errors++; console.log("hello.version is", m.version, "not 2"); }
      for (const cap of ["log.append", "selectables.players", "assist.combat", "assist.blockers"]) {
        if (!(m.caps || []).includes(cap)) { errors++; console.log("hello.caps lacks", cap); }
      }
      if (m.inMatch) {
        console.log("server is already in a match; attaching to it");
        started = true;
      }
      break;
    case "lobby":
      if (gameOver) {
        finish(0);
      } else if (!started) {
        started = true;
        if (stateFile) {
          if (!m.states.includes(stateFile)) {
            console.log("state not offered by lobby:", m.states);
            finish(1);
          }
          send({ t: "startState", state: stateFile });
        } else {
          if (!m.decks.some((d) => d.id === deck)) console.log("deck not listed:", deck);
          send({ t: "startMatch", deck, opponentDeck: opp, opponents });
        }
      }
      break;
    case "state": {
      states++;
      stateBytes += raw.length;
      maxState = Math.max(maxState, raw.length);
      lastStateAt = Date.now();
      if (m.full) {
        cards.clear();
        players.clear();
      } else if (m.seq !== lastSeq + 1) {
        seqProblems++;
      }
      lastSeq = m.seq;
      if (m.game) game = m.game;
      if (m.game && "log" in m.game) { logProblems++; console.log("LOG: game.log present in v2"); }
      if (m.full && !m.logReset) { logProblems++; console.log("LOG: full state without logReset"); }
      if (!m.full && m.logReset) { logProblems++; console.log("LOG: logReset on a non-full state"); }
      if (m.logReset) log = [...(m.logAppend || [])];
      else if (m.logAppend) {
        if (!m.logAppend.length) { logProblems++; console.log("LOG: empty logAppend"); }
        logAppends++;
        log.push(...m.logAppend);
      }
      if (log.length > 200) log = log.slice(-200);
      if (!m.full && (m.cards || []).length + (m.removedCards || []).length === 1) {
        oneCardCount++;
        oneCardMax = Math.max(oneCardMax, raw.length);
        if (!m.players && !m.game) cardOnlyMax = Math.max(cardOnlyMax, raw.length);
        // what v1 would have sent: game (with the last 200 log entries) whenever the log grew, no logAppend
        let v1 = raw.length;
        if (m.logAppend) v1 += -JSON.stringify(m.logAppend).length - 13 + (m.game ? 0 : JSON.stringify(game).length + 8) + JSON.stringify(log).length + 7;
        oneCardV1Max = Math.max(oneCardV1Max, v1);
        if (raw.length > 2048) {
          oneCardOver++;
          if (oneCardOver <= 3) console.log(`one-card state of ${raw.length} B: ${Object.keys(m).join(",")}`);
        }
      }
      for (const p of m.players || []) players.set(p.id, p);
      for (const c of m.cards || []) cards.set(c.id, c);
      for (const id of m.removedCards || []) cards.delete(id);
      for (const p of m.players || []) checkIds(`zones of ${p.name}`, Object.values(p.zones).flat());
      if (maxTurns && game && game.turn > maxTurns) {
        console.log(`reached turn ${game.turn}`);
        finish(0);
      }
      break;
    }
    case "prompt":
      prompt = m;
      if (m.cardId != null) checkIds("prompt", [m.cardId]);
      inputDirty = true;
      break;
    case "buttons":
      buttons = m;
      inputDirty = true;
      break;
    case "selectables":
      selectables = m.cardIds;
      if (!Array.isArray(m.playerIds)) { errors++; console.log("selectables without playerIds"); }
      selectablePlayers = m.playerIds || [];
      if (stateFile && PLAYER_TARGET_EXPECT[stateFile] && !m.cardIds.length && selectablePlayers.length && game
          && prompt && prompt.message.includes("Select any target")) {
        const want = PLAYER_TARGET_EXPECT[stateFile].map((x) => (x === "me" ? game.localPlayerIds[0] : x));
        if (JSON.stringify([...selectablePlayers].sort()) === JSON.stringify(want.sort())) playerTargetSeen = true;
        else { errors++; console.log("selectables.playerIds", selectablePlayers, "expected", want); }
      }
      for (const id of selectablePlayers) if (!players.has(id)) { idProblems++; console.log("unknown selectable player", id); }
      checkIds("selectables", m.cardIds);
      inputDirty = true;
      break;
    case "highlight":
      for (const e of m.entities) {
        if (!known(e)) { idProblems++; console.log("unknown highlight", e); }
        if (m.on) highlighted.add(`${e.kind}:${e.id}`);
        else highlighted.delete(`${e.kind}:${e.id}`);
      }
      break;
    case "playable":
      playable = m.cardIds;
      checkIds("playable", m.cardIds);
      break;
    case "reveal":
      checkIds("reveal", m.cardIds);
      break;
    case "notice":
      inputDirty = true; // a rejected action leaves the same prompt open
      if (m.level === "flash") flashes++;
      else if (verbose || m.level === "error") console.log(`notice ${m.level}: ${m.title} ${m.message}`);
      break;
    case "ask":
      answerAsk(m);
      break;
    case "gameOver":
      gameOver = m;
      console.log(`gameOver: ${m.summary}`);
      setTimeout(() => finish(0), 5000);
      break;
    case "assist":
      if (m.kind === "blockers") {
        blockers = m.blockers;
        if (m.blockers) blockersSeen++;
        checkBlockers(m.blockers);
        inputDirty = true;
      } else if (m.kind === "combat") {
        combatAssists++;
        // the combat prediction follows the block we just assigned
        if (pendingBlock && m.combat && m.combat.blockers.some((x) => x.id === pendingBlock.blockerId)) {
          blockFollowed++;
          blockDone = pendingBlock;
          pendingBlock = null;
          inputDirty = true;
        }
        if (m.combat) checkIds("combat assist", [...m.combat.attackers.map((a) => a.id), ...m.combat.blockers.map((b) => b.id)]);
      } else {
        console.log("unknown assist kind", m.kind);
      }
      break;
    case "error":
      errors++;
      console.log("ERROR from server:", m.message);
      break;
    default:
      console.log("unknown message type", m.t);
  }
};

ws.onerror = (e) => {
  console.log("websocket error", e.message || e);
  finish(1);
};
ws.onclose = () => {
  if (!finished) {
    console.log("connection closed by server");
    finish(1);
  }
};

let lastReport = Date.now();
const timer = setInterval(() => {
  if (Date.now() - lastReport > 10000) {
    lastReport = Date.now();
    console.log(`[${((lastReport - t0) / 1000).toFixed(0)}s] turn ${game ? game.turn : "?"} ${game ? game.phase : ""}, ${cards.size} cards, ${states} states, prompt: ${prompt ? prompt.message.split("\n")[0].slice(0, 60) : ""}`);
  }
  act();
  if (Date.now() - t0 > seconds * 1000) {
    console.log(`time limit of ${seconds}s reached`);
    finish(0);
  }
  if (started && Date.now() - lastStateAt > 120000) {
    console.log("no state for 120s, giving up");
    finish(1);
  }
}, 20);

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  clearInterval(timer);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`--- ${secs}s, turn ${game ? game.turn : "?"}, ${actions} actions, ${flashes} flashes`);
  console.log("messages:", JSON.stringify(counts));
  console.log("asks:", JSON.stringify(askKinds));
  console.log(`state: ${states} messages, avg ${states ? Math.round(stateBytes / states) : 0} B, max ${maxState} B; cards known ${cards.size}`);
  console.log(`one-card states: ${oneCardCount}, max ${oneCardMax} B, over 2 KB: ${oneCardOver}; card-only (no players/game) max ${cardOnlyMax} B (v1 would have sent up to ~${oneCardV1Max} B)`);
  console.log(`log: ${log.length} entries kept, ${logAppends} appends, problems ${logProblems}`);
  console.log(`assists: combat ${combatAssists}, blockers ${blockersSeen} (block followed ${blockFollowed}), blockers problems ${blockersProblems}`);
  console.log(`unknown ids: ${idProblems}, seq gaps: ${seqProblems}, errors: ${errors}`);
  let rc = code;
  if (errors > 0 || states === 0 || logProblems > 0 || blockersProblems > 0 || idProblems > 0) rc = 1;
  if (stateFile && PLAYER_TARGET_EXPECT[stateFile]) {
    console.log(`fixture ${stateFile}: player targets ${playerTargetSeen ? "as expected" : "NOT SEEN"}`);
    if (!playerTargetSeen) rc = 1;
  }
  if (stateFile && BLOCKER_EXPECT[stateFile] && !expectChecked) {
    console.log(`fixture ${stateFile}: no blockers assist arrived`);
    rc = 1;
  }
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(rc), 100);
}
