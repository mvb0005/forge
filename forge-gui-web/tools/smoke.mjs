// Smoke test for the Forge web bridge: plays a whole game against the AI with default answers.
// usage: node tools/smoke.mjs [--port 7777] [--deck random:RG] [--opp random:UB] [--opponents 1] [--format commander]
//                             [--state token-pod-turn12.txt] [--seconds 600] [--turns N] [--verbose] [--passive]
//                             [--concede-on-ai]  with --turns: concede during an AI's turn instead of at our priority
// Policy: answer asks with a valid default; in our main phases with OK enabled, first try each playable
// card once (lands first) unless --passive, then OK; otherwise click a selectable (Cancel after 5 repeats
// of the same prompt); otherwise a selectable player; otherwise Cancel; with nothing enabled at all, click our
// own player. While declaring blockers it first assigns one legal block from the `blockers` assist and checks
// that the combat assist follows it.
// Checks (protocol v2): hello version and caps, the log arrives append-only, `blockers` assists are sane (and match
// the expectations below for the blockers-*.txt fixtures), and reports the largest state message for a one-card change.
// --format commander starts a Commander match from the lobby's commanderDecks (default: random precons, 3 opponents) and
// checks 40 starting life, a commander in every command zone, and that casts/tax only go up (tax higher after a recast).
// Optional fields: basePower/baseToughness, keywordLabels, colorIdentity, commanders/commanderDamage, turnOrder and
// the `mana` assist are checked for shape whenever they arrive.
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const port = Number(opt("port", 7777));
const format = opt("format", "constructed");
const commander = format === "commander";
const deck = opt("deck", commander ? "cmdr:randomprecon" : "random:RG");
const opp = opt("opp", commander ? "cmdr:randomprecon" : "random:UB");
const opponents = Number(opt("opponents", commander ? 3 : 1));
const stateFile = opt("state", null);
const seconds = Number(opt("seconds", stateFile ? 900 : 600));
const maxTurns = Number(opt("turns", 0));
const verbose = flag("verbose");
const passive = flag("passive");
const concedeOnAi = flag("concede-on-ai");

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

// fixture -> card name -> fields its CardDto must have, and the first `mana` assist by player ("me" = our seat)
const FIELD_EXPECT = {
  "fields-badges.txt": {
    cards: {
      "Phantom Warrior": { keywords: ["can't be blocked"] },
      "White Knight": { keywords: ["first strike", "protection"], keywordLabels: { protection: ["Protection from black"] } },
      "Inkwell Leviathan": { keywords: ["trample", "shroud"] },
      "Grizzly Bears": { power: 3, toughness: 3, basePower: 2, baseToughness: 2 },
    },
    mana: { me: { W: 2, U: 1 }, 1: { R: 1 } },
    colorIdentity: { me: ["W", "U", "G"], 1: ["R"] },
  },
  "token-pod-turn12.txt": { cards: { "Emmara, Soul of the Accord": {} }, colorIdentity: { me: ["W", "G"], 1: ["B", "G"], 2: ["U", "R", "G"], 3: ["W", "U", "B", "R", "G"] } },
};
let fieldsChecked = false, manaChecked = false;

// Commander: every seat at the first prompt, then casts per commander card
let cmdrStartChecked = false, cmdrProblems = 0, cmdrRecasts = 0, cmdrCasts = 0;
const cmdrSeen = new Map(); // cardId -> { casts, tax }
const cmdrProblem = (what) => {
  cmdrProblems++;
  if (cmdrProblems <= 20) console.log("COMMANDER:", what);
};
function checkCommanderStart() {
  if (!commander || cmdrStartChecked || players.size < opponents + 1) return;
  cmdrStartChecked = true;
  for (const p of players.values()) {
    if (p.life !== 40) cmdrProblem(`${p.name} starts at ${p.life} life`);
    if (!p.commanders || !p.commanders.length) { cmdrProblem(`${p.name} has no commanders`); continue; }
    for (const e of p.commanders) {
      if (!p.zones.command.includes(e.cardId)) cmdrProblem(`${p.name}: commander ${nameOf(e.cardId)} not in the command zone`);
      if (e.casts !== 0) cmdrProblem(`${p.name}: ${nameOf(e.cardId)} starts with ${e.casts} casts`);
    }
  }
  console.log(`commander start: ${[...players.values()].map((p) => `${p.name} ${p.life} [${(p.commanders || []).map((e) => nameOf(e.cardId)).join(" + ")}]`).join(", ")}`);
}
function checkCommanderCasts(p) {
  if (!commander) return;
  for (const e of p.commanders || []) {
    const before = cmdrSeen.get(e.cardId);
    if (before && e.casts < before.casts) cmdrProblem(`${p.name}: ${nameOf(e.cardId)} casts went down ${before.casts} -> ${e.casts}`);
    if (before && e.casts > before.casts) {
      cmdrCasts++;
      if (before.casts >= 1) {
        cmdrRecasts++;
        if (!(e.tax > before.tax)) cmdrProblem(`${p.name}: ${nameOf(e.cardId)} recast without more tax (${before.tax} -> ${e.tax})`);
        else console.log(`recast: ${p.name} ${nameOf(e.cardId)} cast #${e.casts}, tax ${before.tax} -> ${e.tax}`);
      }
    }
    cmdrSeen.set(e.cardId, { casts: e.casts, tax: e.tax });
  }
}

const counts = {};
const askKinds = {};
let maxState = 0, stateBytes = 0, states = 0, errors = 0, idProblems = 0, seqProblems = 0;
let capped = 0, conceded = false;
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
let extraProblems = 0, firstMana = null, lastMana = null, manaAssists = 0;
const fieldSamples = {};
const seenExtra = { basePT: 0, keywordLabels: 0, unblockable: 0, colorIdentity: 0, commanders: 0, commanderDamage: 0, turnOrder: 0 };
const extraProblem = (what) => {
  extraProblems++;
  if (extraProblems <= 20) console.log("FIELDS:", what);
};
const KEYWORD_KEYS = new Set(["flying", "reach", "deathtouch", "trample", "lifelink", "first strike", "double strike", "vigilance", "menace",
  "haste", "hexproof", "indestructible", "infect", "defender", "shroud", "protection", "ward", "can't be blocked"]);
function checkCard(c) {
  for (const k of c.keywords) if (!KEYWORD_KEYS.has(k)) extraProblem(`${c.name}: unknown keyword key ${k}`);
  if (c.keywords.includes("can't be blocked")) { seenExtra.unblockable++; fieldSamples.unblockable ??= c.name; }
  if ("basePower" in c || "baseToughness" in c) {
    seenExtra.basePT++;
    fieldSamples.basePT ??= `${c.name} ${c.power}/${c.toughness} (base ${c.basePower}/${c.baseToughness})`;
    if (!Number.isInteger(c.basePower) || !Number.isInteger(c.baseToughness) || c.power == null) extraProblem(`${c.name}: bad base P/T`);
    else if (c.basePower === c.power && c.baseToughness === c.toughness) extraProblem(`${c.name}: base P/T sent though equal`);
  }
  if (c.keywordLabels) {
    seenExtra.keywordLabels++;
    fieldSamples.keywordLabels ??= `${c.name} ${JSON.stringify(c.keywordLabels)}`;
    for (const [k, v] of Object.entries(c.keywordLabels)) {
      if (!c.keywords.includes(k)) extraProblem(`${c.name}: label for absent keyword ${k}`);
      if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== "string" || !x)) extraProblem(`${c.name}: bad labels for ${k}`);
    }
  }
}
function checkPlayer(p) {
  if (p.colorIdentity) {
    seenExtra.colorIdentity++;
    if (!Array.isArray(p.colorIdentity) || p.colorIdentity.some((x) => !"WUBRG".includes(x) || x.length !== 1)) extraProblem(`${p.name}: bad colorIdentity`);
  }
  if (p.commanders) {
    seenExtra.commanders++;
    for (const e of p.commanders) {
      if (!cards.has(e.cardId)) extraProblem(`${p.name}: unknown commander ${e.cardId}`);
      if (e.tax !== 2 * e.casts) extraProblem(`${p.name}: tax ${e.tax} for ${e.casts} casts`);
    }
  }
  if (p.commanderDamage) {
    seenExtra.commanderDamage++;
    for (const e of p.commanderDamage) if (!(e.damage > 0) || !cards.has(e.cardId)) extraProblem(`${p.name}: bad commanderDamage ${JSON.stringify(e)}`);
  }
}
function checkFieldExpect() {
  const expect = stateFile && FIELD_EXPECT[stateFile];
  if (!expect || fieldsChecked) return;
  fieldsChecked = true;
  for (const [name, want] of Object.entries(expect.cards)) {
    const c = [...cards.values()].find((x) => x.name === name);
    if (!c) { extraProblem(`fixture: no ${name}`); continue; }
    for (const [k, v] of Object.entries(want)) {
      const got = k === "keywords" ? [...c.keywords].sort() : c[k];
      const exp = k === "keywords" ? [...v].sort() : v;
      if (JSON.stringify(got) !== JSON.stringify(exp)) extraProblem(`fixture: ${name}.${k} ${JSON.stringify(got)} != ${JSON.stringify(exp)}`);
    }
  }
}
function checkMana(mana) {
  manaAssists++;
  if (!mana) return;
  const expect = stateFile && FIELD_EXPECT[stateFile];
  // the first assist after the board is set up (assists also arrive before the saved state is applied)
  const boardUp = expect && [...cards.values()].some((c) => c.name in expect.cards);
  if (boardUp && !manaChecked && game) {
    manaChecked = true;
    checkFieldExpect(); // board facts are read at the decision point that sent this assist, and flushed before it
    for (const [who, want] of Object.entries(expect.colorIdentity || {})) {
      const id = who === "me" ? game.localPlayerIds[0] : Number(who);
      const got = players.get(id) && players.get(id).colorIdentity;
      if (JSON.stringify(got) !== JSON.stringify(want)) extraProblem(`fixture: colorIdentity of ${id} ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
    }
    for (const [who, want] of Object.entries(expect.mana || {})) {
      const id = who === "me" ? game.localPlayerIds[0] : Number(who);
      const e = mana.players.find((x) => x.id === id);
      if (!e || !sameJson(e.open, want)) extraProblem(`fixture: mana of ${id} ${JSON.stringify(e && e.open)} != ${JSON.stringify(want)}`);
    }
  }
  if (!firstMana) firstMana = mana;
  if (mana.players.some((e) => e.total > 0)) lastMana = mana;
  for (const e of mana.players) {
    if (!players.has(e.id)) extraProblem(`mana for unknown player ${e.id}`);
    let sum = 0;
    for (const [k, n] of Object.entries(e.open)) {
      if (!/^(any|W?U?B?R?G?C?)$/.test(k) || !k || !(n > 0)) extraProblem(`mana: bad entry ${k}:${n}`);
      sum += n;
    }
    if (sum !== e.total) extraProblem(`mana: total ${e.total} != ${sum}`);
  }
}
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
  const mineNow = game && game.priorityPlayerId != null && game.localPlayerIds.includes(game.priorityPlayerId);
  if (capped && !concedeOnAi && !conceded && (mineNow || Date.now() - capped > 60000)) {
    // with our priority the game thread is parked waiting for us; conceding during an AI's turn races it (Game.onPlayerLost)
    conceded = true;
    send({ t: "concede" });
    setTimeout(() => finish(0), 15000);
    return;
  }
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
      for (const cap of ["log.append", "selectables.players", "assist.combat", "assist.blockers", "assist.mana", "card.basePT",
        "card.keywordLabels", "player.colorIdentity", "player.commander", "game.turnOrder"]) {
        if (!(m.caps || []).includes(cap)) { errors++; console.log("hello.caps lacks", cap); }
      }
      if (m.inMatch && commander) {
        console.log("server is already in a match; a Commander run needs the lobby");
        finish(1);
      } else if (m.inMatch) {
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
          const list = commander ? m.commanderDecks || [] : m.decks;
          if (commander) console.log(`lobby: ${list.length} commander decks, e.g. ${JSON.stringify(list.slice(2, 4))}`);
          for (const id of [deck, opp]) if (!list.some((d) => d.id === id)) { errors++; console.log("deck not listed:", id); }
          send(commander ? { t: "startMatch", format, deck, opponentDeck: opp, opponents } : { t: "startMatch", deck, opponentDeck: opp, opponents });
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
      for (const c of m.cards || []) checkCard(c);
      for (const p of m.players || []) checkPlayer(p);
      for (const p of m.players || []) checkCommanderCasts(p);
      if (m.game && m.game.turnOrder) {
        seenExtra.turnOrder++;
        for (const id of m.game.turnOrder) if (!players.has(id)) extraProblem(`turnOrder: unknown player ${id}`);
      }
      for (const p of m.players || []) checkIds(`zones of ${p.name}`, Object.values(p.zones).flat());
      if (maxTurns && game && game.turn > maxTurns && !capped) {
        // concede (in act(), once we hold priority) so the server is back in the lobby for the next run
        capped = Date.now();
        console.log(`reached turn ${game.turn}, conceding ${concedeOnAi ? "during an AI's turn" : "at our next priority"}`);
      }
      if (capped && concedeOnAi && !conceded && game && game.activePlayerId != null && !game.localPlayerIds.includes(game.activePlayerId)) {
        conceded = true;
        console.log(`conceding on turn ${game.turn} while ${game.activePlayerId} is active`);
        send({ t: "concede" });
        setTimeout(() => {
          if (!gameOver) { console.log("FAIL: concede during an AI's turn did not end the game"); finish(1); }
        }, 20000);
      }
      break;
    }
    case "prompt":
      prompt = m;
      checkCommanderStart(); // the first decision (mulligan): the game is set up, before anyone has cast anything
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
      } else if (m.kind === "mana") {
        checkMana(m.mana);
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
  console.log(`fields seen (messages): ${JSON.stringify(seenExtra)}; mana assists ${manaAssists}; field problems ${extraProblems}`);
  if (firstMana) console.log("first mana assist:", JSON.stringify(firstMana));
  if (lastMana) console.log("last non-empty mana assist:", JSON.stringify(lastMana));
  if (Object.keys(fieldSamples).length) console.log("samples:", JSON.stringify(fieldSamples));
  if (commander) console.log(`commander: start ${cmdrStartChecked ? "checked" : "NOT CHECKED"}, casts ${cmdrCasts}, recasts ${cmdrRecasts}, problems ${cmdrProblems}`);
  console.log(`unknown ids: ${idProblems}, seq gaps: ${seqProblems}, errors: ${errors}`);
  let rc = code;
  if (commander && (!cmdrStartChecked || cmdrProblems > 0)) rc = 1;
  if (errors > 0 || states === 0 || logProblems > 0 || blockersProblems > 0 || idProblems > 0 || extraProblems > 0) rc = 1;
  if (stateFile && PLAYER_TARGET_EXPECT[stateFile]) {
    console.log(`fixture ${stateFile}: player targets ${playerTargetSeen ? "as expected" : "NOT SEEN"}`);
    if (!playerTargetSeen) rc = 1;
  }
  if (stateFile && FIELD_EXPECT[stateFile]) {
    console.log(`fixture ${stateFile}: fields ${fieldsChecked ? "checked" : "NOT CHECKED"}, mana ${manaChecked ? "checked" : "NOT CHECKED"}`);
    if (!fieldsChecked || !manaChecked) rc = 1;
  }
  if (stateFile && BLOCKER_EXPECT[stateFile] && !expectChecked) {
    console.log(`fixture ${stateFile}: no blockers assist arrived`);
    rc = 1;
  }
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(rc), 100);
}
