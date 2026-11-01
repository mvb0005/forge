package forge.web;

import com.google.common.eventbus.Subscribe;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import forge.LobbyPlayer;
import forge.card.MagicColor;
import forge.card.mana.ManaAtom;
import forge.deck.CardPool;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.GameEntity;
import forge.game.GameEntityView;
import forge.game.GameLog;
import forge.game.GameLogEntry;
import forge.game.GameObject;
import forge.game.GameState;
import forge.game.GameView;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.combat.Combat;
import forge.game.event.GameEvent;
import forge.game.event.GameEventSpellAbilityCast;
import forge.game.event.GameEventSpellRemovedFromStack;
import forge.game.event.GameEventTurnPhase;
import forge.game.phase.PhaseType;
import forge.game.player.DelayedReveal;
import forge.game.player.IHasIcon;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityView;
import forge.gamemodes.match.AbstractGuiGame;
import forge.gamemodes.match.HostedMatch;
import forge.gamemodes.match.NextGameDecision;
import forge.gamemodes.match.input.InputAttack;
import forge.gamemodes.match.input.InputConfirm;
import forge.gamemodes.match.input.InputPassPriority;
import forge.gamemodes.match.input.InputPayMana;
import forge.gamemodes.match.input.InputSelectEntitiesFromList;
import forge.gamemodes.match.input.InputSelectTargets;
import forge.gui.interfaces.IGuiGame;
import forge.interfaces.IGameController;
import forge.item.PaperCard;
import forge.localinstance.skin.FSkinProp;
import forge.player.PlayerControllerHuman;
import forge.player.PlayerZoneUpdate;
import forge.trackable.TrackableCollection;
import forge.util.FSerializableFunction;
import forge.util.ITriggerEvent;
import forge.util.ThreadUtil;
import forge.web.assist.Assists;
import forge.web.assist.Samples;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Predicate;

/**
 * The human seat's IGuiGame. Projects the game into protocol DTOs (diffed and coalesced),
 * turns every blocking GUI call into an {@code ask}, and routes client actions to the game controller.
 */
public final class WebGuiGame extends AbstractGuiGame implements WebGameSession {
    private static final long FLUSH_INTERVAL_NANOS = TimeUnit.MILLISECONDS.toNanos(33);
    /**
     * Seconds a player has to respond when they hold priority on someone else's turn or with something on the
     * stack; then the server passes for them (0: no timer). Their own turn's priority stays untimed, and no
     * choice (targets, attackers, blockers) is ever made for them. Set from {@code --respond-seconds}.
     */
    static volatile int respondSeconds = 10;
    private static final ScheduledExecutorService RESPOND = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "Respond timer");
        t.setDaemon(true);
        return t;
    });
    /** Seconds "In response" adds to a running respond timer (the client's moreTime). */
    static final int MORE_SECONDS = 20;
    // guarded by io
    private ScheduledFuture<?> respondTimer;
    private long respondDeadline; // System.currentTimeMillis() when the timer passes
    private Runnable respondPass;

    private static final ScheduledExecutorService FLUSHER = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "Web state flush");
        t.setDaemon(true);
        return t;
    });

    private final HostedMatch match;
    private final ViewProjector proj = new ViewProjector(this);

    // everything below that is not volatile is guarded by io, which also orders every outgoing message
    private final Object io = new Object();
    private ClientChannel channel;
    /** This seat's replay, if the match records one: everything sent, connected or not. */
    private Recorder recorder;
    private boolean capturing;
    private JsonObject captured;
    private boolean forceFull = true;
    private boolean resendAfterFull = true;
    private long seq;
    private String sentGame;
    private String sentStack;
    private String sentCombat;
    private int sentLog;
    private final Map<Integer, String> sentPlayers = new HashMap<>();
    private final Map<Integer, String> sentCards = new HashMap<>();
    private final Map<Integer, CardView> knownCards = new ConcurrentHashMap<>();
    private final Set<CardView> askCards = new HashSet<>();
    private final Set<CardView> revealCards = new HashSet<>();
    private final Set<CardView> selectCards = new LinkedHashSet<>();
    private final Map<String, JsonObject> highlighted = new LinkedHashMap<>();
    private final Set<CardView> highlightCards = new HashSet<>();
    private JsonObject lastPrompt;
    private CardView promptCard;
    private JsonObject lastButtons;
    private JsonObject lastSelectables;
    private List<Integer> selectPlayers = List.of();
    private int selectMin;
    private int selectMax;
    private JsonObject lastPlayable;
    private JsonObject lastReveal;

    private final Object schedLock = new Object();
    private boolean flushScheduled;
    private volatile long lastFlush;
    private volatile boolean disposed;

    private final ReentrantLock askLock = new ReentrantLock(true);
    private volatile OpenAsk open;
    private int askSeq;

    private final Assists assists = Assists.standard();
    private final BoardFacts facts = new BoardFacts();
    // latches of the game threads waiting in awaitInput for the human. Usually one; paying mana can nest a second
    // (InputPayMana runs the mana ability on another game-pool thread, which may ask again). WebEdt owns the game
    // while every one of them is waiting.
    private final List<CountDownLatch> parked = new CopyOnWriteArrayList<>();
    private volatile boolean concedePending;
    private Game concedeHooked; // guarded by io

    // stats, guarded by io
    private long flushCount;
    private long flushNanos;
    private final Samples flushTimes = new Samples();
    private long stateCount;
    private long stateBytes;
    private long stateMaxBytes;

    private static final class OpenAsk {
        final int id;
        final JsonObject msg;
        final CompletableFuture<JsonElement> answer = new CompletableFuture<>();

        OpenAsk(int id, JsonObject msg) {
            this.id = id;
            this.msg = msg;
        }
    }

    BoardFacts facts() {
        return facts;
    }

    public WebGuiGame(HostedMatch match) {
        this.match = match;
    }

    @Override
    public IGuiGame gui() {
        return this;
    }

    // ---------------------------------------------------------------- connection

    @Override
    public void onConnect(ClientChannel ch) {
        synchronized (io) {
            channel = ch;
            forceFull = true;
            resendAfterFull = false;
            flushLocked();
            resendAfterFull = true;
            assists.current().forEach(ch::send);
            for (JsonObject m : new JsonObject[] {lastPrompt, lastButtons, lastSelectables, lastPlayable}) {
                if (m != null) {
                    ch.send(m);
                }
            }
            if (!highlighted.isEmpty()) {
                JsonObject h = msg("highlight");
                JsonArray a = new JsonArray();
                highlighted.values().forEach(a::add);
                h.add("entities", a);
                h.addProperty("on", true);
                ch.send(h);
            }
            if (lastReveal != null) {
                ch.send(lastReveal);
            }
            OpenAsk a = open;
            if (a != null) {
                ch.send(a.msg);
            }
        }
    }

    void onDisconnect(ClientChannel ch) {
        synchronized (io) {
            if (channel == ch) {
                channel = null;
            }
        }
    }

    void dispose() {
        disposed = true;
        synchronized (io) {
            if (respondTimer != null) {
                respondTimer.cancel(false);
                respondTimer = null;
            }
        }
        OpenAsk a = open;
        if (a != null) {
            a.answer.complete(null);
        }
        synchronized (io) {
            if (flushCount > 0) {
                System.out.printf("Web stats: %d flushes, avg %.2f ms, p95 %.2f ms, max %.2f ms; %d state messages, avg %d B, max %d B; assist computes: %s; board facts %s%n",
                        flushCount, flushNanos / 1e6 / flushCount, flushTimes.p95Nanos() / 1e6, flushTimes.maxNanos() / 1e6,
                        stateCount, stateCount == 0 ? 0 : stateBytes / stateCount, stateMaxBytes, assists.stats(), facts.stats());
            }
        }
    }

    private static JsonObject msg(String t) {
        JsonObject o = new JsonObject();
        o.addProperty("t", t);
        return o;
    }

    private void sendLocked(JsonObject m) {
        if (capturing) {
            captured = m;
            return;
        }
        if (recorder != null) {
            recorder.add(m.toString());
        }
        ClientChannel ch = channel;
        if (ch != null) {
            ch.send(m);
        }
    }

    /** Seat name -> {Discord avatar URL, Discord user id} (either may be null), from the match spec. */
    private Map<String, String[]> faces = Map.of();

    void faces(Map<String, String[]> byName) {
        faces = Map.copyOf(byName);
    }

    String[] face(String name) {
        return name == null ? null : faces.get(name);
    }

    void record(Recorder r) {
        synchronized (io) {
            recorder = r;
        }
    }

    /** A full state of the board as this seat sees it now, sent and recorded nowhere (a replay's last line). */
    String snapshot() {
        synchronized (io) {
            capturing = true;
            captured = null;
            boolean wasFull = forceFull;
            boolean resend = resendAfterFull;
            forceFull = true;
            resendAfterFull = false;
            try {
                flushLocked();
            } finally {
                capturing = false;
                resendAfterFull = resend;
                forceFull = wasFull || captured != null;
            }
            return captured == null ? null : captured.toString();
        }
    }

    /** Flushes state first, so every id in m is already known to the client. */
    private void sendUi(JsonObject m) {
        synchronized (io) {
            flushLocked();
            sendLocked(m);
        }
    }

    private void notice(String level, String title, String message) {
        JsonObject n = msg("notice");
        n.addProperty("level", level);
        n.addProperty("title", title == null ? "" : title);
        n.addProperty("message", message == null ? "" : message);
        sendUi(n);
    }

    // ---------------------------------------------------------------- state sync

    private void dirty() {
        if (disposed) {
            return;
        }
        synchronized (schedLock) {
            if (flushScheduled) {
                return;
            }
            flushScheduled = true;
        }
        long wait = Math.max(0, FLUSH_INTERVAL_NANOS - (System.nanoTime() - lastFlush));
        FLUSHER.schedule(() -> {
            synchronized (schedLock) {
                flushScheduled = false;
            }
            flush();
        }, wait, TimeUnit.NANOSECONDS);
    }

    void flush() {
        synchronized (io) {
            flushLocked();
        }
    }

    private void flushLocked() {
        GameView gv = getGameView();
        if (gv == null || channel == null && recorder == null && !capturing) {
            return;
        }
        long t0 = System.nanoTime();
        lastFlush = t0;
        boolean full = forceFull;
        JsonObject m = msg("state");
        try {
            JsonObject game = proj.game(gv);
            String gs = game.toString();
            boolean gameChanged = full || !gs.equals(sentGame);

            List<JsonObject> players = new ArrayList<>();
            Map<Integer, String> newPlayers = new HashMap<>();
            Set<CardView> cards = new LinkedHashSet<>();
            for (PlayerView p : gv.getPlayers()) {
                JsonObject po = proj.player(p);
                String ps = po.toString();
                if (full || !ps.equals(sentPlayers.get(p.getId()))) {
                    players.add(po);
                    newPlayers.put(p.getId(), ps);
                }
                for (forge.game.zone.ZoneType z : ViewProjector.PLAYER_ZONES) {
                    Iterable<CardView> zc = p.getCards(z);
                    if (zc != null) {
                        for (CardView c : zc) {
                            cards.add(c);
                        }
                    }
                }
            }
            for (PlayerView p : gv.getPlayers()) {
                if (p.getCommanders() != null) {
                    cards.addAll(p.getCommanders());
                }
            }
            ViewProjector.stackCards(gv, cards);
            cards.addAll(askCards);
            cards.addAll(revealCards);
            cards.addAll(selectCards);
            cards.addAll(highlightCards);
            if (promptCard != null) {
                cards.add(promptCard);
            }

            List<JsonObject> changed = new ArrayList<>();
            Map<Integer, String> newCards = new HashMap<>();
            Set<Integer> seen = new HashSet<>();
            for (CardView c : cards) {
                if (c == null || !seen.add(c.getId())) {
                    continue;
                }
                JsonObject co = proj.card(c);
                String cs = co.toString();
                if (full || !cs.equals(sentCards.get(c.getId()))) {
                    changed.add(co);
                    newCards.put(c.getId(), cs);
                }
                knownCards.put(c.getId(), c);
            }
            List<Integer> removed = new ArrayList<>();
            if (!full) {
                for (Integer id : sentCards.keySet()) {
                    if (!seen.contains(id)) {
                        removed.add(id);
                    }
                }
            }

            String st = proj.stack(gv).toString();
            boolean stackChanged = full || !st.equals(sentStack);
            JsonElement combat = proj.combat(gv);
            String cbs = combat.toString();
            boolean combatChanged = full || !cbs.equals(sentCombat);

            GameLog gl = gv.getGameLog();
            List<GameLogEntry> log = gl == null ? List.of() : gl.getAllEntries();
            boolean logReset = full || log.size() < sentLog;
            int logFrom = Math.max(logReset ? 0 : sentLog, log.size() - ViewProjector.LOG_LIMIT);

            if (!gameChanged && players.isEmpty() && changed.isEmpty() && removed.isEmpty() && !stackChanged && !combatChanged
                    && !logReset && logFrom >= log.size()) {
                recordFlush(t0);
                return;
            }

            m.addProperty("seq", ++seq);
            m.addProperty("full", full);
            if (gameChanged) {
                m.add("game", game);
                sentGame = gs;
            }
            if (!players.isEmpty() || full) {
                JsonArray a = new JsonArray();
                players.forEach(a::add);
                m.add("players", a);
            }
            if (!changed.isEmpty() || full) {
                JsonArray a = new JsonArray();
                changed.forEach(a::add);
                m.add("cards", a);
            }
            if (!removed.isEmpty()) {
                JsonArray a = new JsonArray();
                removed.forEach(a::add);
                m.add("removedCards", a);
            }
            if (stackChanged) {
                m.add("stack", com.google.gson.JsonParser.parseString(st));
                sentStack = st;
            }
            if (combatChanged) {
                m.add("combat", combat);
                sentCombat = cbs;
            }
            if (logReset || logFrom < log.size()) {
                JsonArray a = new JsonArray();
                for (int i = logFrom; i < log.size(); i++) {
                    a.add(ViewProjector.logEntry(log.get(i)));
                }
                m.add("logAppend", a);
                if (logReset) {
                    m.addProperty("logReset", true);
                }
            }
            sentLog = log.size();
            if (full) {
                sentPlayers.clear();
                sentCards.clear();
                knownCards.keySet().retainAll(seen);
            }
            sentPlayers.putAll(newPlayers);
            sentCards.putAll(newCards);
            for (Integer id : removed) {
                sentCards.remove(id);
                knownCards.remove(id);
            }
            forceFull = false;
        } catch (RuntimeException e) {
            // the game thread mutates the views while we read them; try again shortly
            System.err.println("State flush failed, retrying: " + e);
            dirty();
            return;
        }
        String json = m.toString();
        recordFlush(t0);
        stateCount++;
        stateBytes += json.length();
        stateMaxBytes = Math.max(stateMaxBytes, json.length());
        sendLocked(m);
        if (full && resendAfterFull) {
            // the client drops its open ask and reveal on a full state
            if (lastReveal != null) {
                sendLocked(lastReveal);
            }
            OpenAsk a = open;
            if (a != null) {
                sendLocked(a.msg);
            }
        }
    }

    private void recordFlush(long t0) {
        long dt = System.nanoTime() - t0;
        flushCount++;
        flushNanos += dt;
        flushTimes.add(dt);
    }

    // ---------------------------------------------------------------- decision points

    /** The game thread waits here for each of the human's inputs: the main decision point. */
    @Override
    public void awaitInput(CountDownLatch done) throws InterruptedException {
        concedeIfPending();
        decisionPoint();
        parked.add(done);
        try {
            done.await();
        } finally {
            parked.remove(done);
            synchronized (io) {
                if (!selectPlayers.isEmpty()) {
                    selectPlayers = List.of();
                    sendSelectablesLocked();
                }
            }
        }
    }

    /**
     * Runs the assist producers and works out the clickable players for what the engine is asking
     * the human now. Only reads the game when this thread owns it: a game thread (in awaitInput or an
     * ask), or WebEdt while every game thread is parked in awaitInput (the human's input changes the game
     * on WebEdt then, and only WebEdt releases those latches) and no mana ability is running for the
     * current input on another game thread. Anywhere else it does nothing.
     */
    private void decisionPoint() {
        if (disposed) {
            return;
        }
        Game game = match.getGame();
        Player seat = seat(game);
        if (seat == null) {
            return;
        }
        Object input = seat.getController() instanceof PlayerControllerHuman h ? h.getInputQueue().getInput() : null;
        if (!ThreadUtil.isGameThread()) {
            List<CountDownLatch> waiting = List.copyOf(parked);
            if (!WebEdt.isEdt() || waiting.isEmpty() || waiting.stream().anyMatch(l -> l.getCount() == 0)
                    || (input instanceof InputPayMana pm && pm.isActivatingManaAbility())) {
                return;
            }
        }
        List<JsonObject> out;
        List<Integer> players;
        try {
            facts.update(game);
        } catch (RuntimeException e) {
            System.err.println("Board facts failed: " + e);
        }
        try {
            out = assists.update(game, seat, Assists.decisionKey(game, seat, input));
            players = selectablePlayers(game, input);
        } catch (RuntimeException e) {
            System.err.println("Decision point failed: " + e);
            return;
        }
        synchronized (io) {
            flushLocked();
            if (!players.equals(selectPlayers)) {
                selectPlayers = players;
                sendSelectablesLocked();
            }
            out.forEach(this::sendLocked);
        }
    }

    private Player seat(Game game) {
        if (game == null) {
            return null;
        }
        for (PlayerView pv : getLocalPlayers()) {
            Player p = game.getPlayer(pv);
            if (p != null) {
                return p;
            }
        }
        return null;
    }

    private static final Field TARGETS_SA = targetsField("sa");
    private static final Field TARGETS_FILTER = targetsField("filter");
    private static final Field TARGETS_MUST_FILTERED = targetsField("mustTargetFiltered");

    private static Field targetsField(String name) {
        try {
            Field f = InputSelectTargets.class.getDeclaredField(name);
            f.setAccessible(true);
            return f;
        } catch (Exception e) {
            System.err.println("InputSelectTargets." + name + " not readable, player targets won't be offered: " + e);
            return null;
        }
    }

    /**
     * Players a click does something for in the current input. Forge has no GUI call for this
     * (setSelectables only takes cards), so it's read from the input. InputSelectTargets keeps its
     * spell ability and filter private: they're read reflectively and its onPlayerSelected checks repeated.
     */
    @SuppressWarnings("unchecked")
    private static List<Integer> selectablePlayers(Game game, Object input) {
        List<Integer> out = new ArrayList<>();
        if (input instanceof InputSelectEntitiesFromList<?> in) {
            for (GameEntity e : in.getValidChoices()) {
                if (e instanceof Player pl) {
                    out.add(pl.getId());
                }
            }
        } else if (input instanceof InputSelectTargets in && TARGETS_SA != null && TARGETS_FILTER != null && TARGETS_MUST_FILTERED != null) {
            try {
                SpellAbility sa = (SpellAbility) TARGETS_SA.get(in);
                Predicate<GameObject> filter = (Predicate<GameObject>) TARGETS_FILTER.get(in);
                if (sa == null || (boolean) TARGETS_MUST_FILTERED.get(in)) {
                    return out;
                }
                Card host = sa.getHostCard();
                for (Player pl : game.getPlayers()) {
                    if (pl.hasLost() || !sa.canTarget(pl) || (filter != null && !filter.test(pl))
                            || (sa.isSpell() && host.isAura() && !pl.canBeAttached(host, sa))) {
                        continue;
                    }
                    out.add(pl.getId());
                }
            } catch (IllegalAccessException e) {
                return out;
            }
        } else if (input instanceof InputAttack) {
            Combat combat = game.getCombat();
            if (combat != null) {
                for (GameEntity d : combat.getDefenders()) {
                    if (d instanceof Player pl) {
                        out.add(pl.getId());
                    }
                }
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- client messages

    @Override
    public void onClientMessage(JsonObject m) {
        String t = str(m, "t", "");
        if (t.equals("answer")) {
            OpenAsk a = open;
            int id;
            try {
                id = m.get("id").getAsInt();
            } catch (Exception e) {
                System.err.println("Ignoring answer without a numeric id");
                return;
            }
            if (a != null && a.id == id) {
                JsonElement v = m.get("value");
                a.answer.complete(v == null ? JsonNull.INSTANCE : v);
            } else {
                System.err.println("Ignoring answer to ask " + id);
            }
            return;
        }
        IGameController ctrl = getGameController();
        if (ctrl == null) {
            return;
        }
        switch (t) {
            case "moreTime" -> moreTime();
            case "selectCard" -> {
                CardView c = knownCards.get(m.get("cardId").getAsInt());
                if (c == null) {
                    flashIncorrectAction();
                    return;
                }
                List<CardView> others = null;
                if (m.has("others") && m.get("others").isJsonArray()) {
                    others = new ArrayList<>();
                    for (JsonElement e : m.getAsJsonArray("others")) {
                        CardView o = knownCards.get(e.getAsInt());
                        if (o != null && o != c) {
                            others.add(o);
                        }
                    }
                }
                ctrl.selectCard(c, others, trigger(m));
            }
            case "selectPlayer" -> {
                PlayerView p = player(m.get("playerId").getAsInt());
                if (p != null) {
                    ctrl.selectPlayer(p, trigger(m));
                }
            }
            case "ok" -> ctrl.selectButtonOk();
            case "cancel" -> ctrl.selectButtonCancel();
            case "useMana" -> {
                byte b = switch (str(m, "color", "")) {
                    case "W" -> MagicColor.WHITE;
                    case "U" -> MagicColor.BLUE;
                    case "B" -> MagicColor.BLACK;
                    case "R" -> MagicColor.RED;
                    case "G" -> MagicColor.GREEN;
                    case "C" -> (byte) ManaAtom.COLORLESS;
                    default -> 0;
                };
                if (b != 0) {
                    ctrl.useMana(b);
                }
            }
            case "undo" -> ctrl.undoLastAction();
            case "alphaStrike" -> ctrl.alphaStrike();
            case "concede" -> concedeNow();
            case "reorderHand" -> {
                CardView c = knownCards.get(m.get("cardId").getAsInt());
                if (c != null) {
                    ctrl.reorderHand(c, m.get("index").getAsInt());
                }
            }
            default -> System.err.println("Unknown client message " + t);
        }
    }

    private volatile boolean endPending;

    /**
     * The host ends the match for everyone. Like a concede it only touches the game while the game thread is
     * parked; otherwise the game thread does it at its next phase change or its next wait for a player.
     */
    void endForHost() {
        GameView gv = getGameView();
        if (gv == null || gv.isGameOver()) {
            return;
        }
        Game g = gv.getGame();
        if (g != null && !gameThreadParked()) {
            synchronized (io) {
                if (concedeHooked != g) {
                    g.subscribeToEvents(concedeHook);
                    concedeHooked = g;
                }
            }
            endPending = true;
            return;
        }
        endNow();
    }

    /** Every human concedes and the game is over; then every human's waiting input lets go, as when a game ends. */
    private void endNow() {
        GameView gv = getGameView();
        Game g = gv == null ? null : gv.getGame();
        if (g == null || g.isGameOver()) {
            return;
        }
        for (Player p : g.getRegisteredPlayers()) {
            if (p.getController() instanceof PlayerControllerHuman && !p.hasLost()) {
                p.concede();
            }
        }
        if (!g.isGameOver()) {
            g.setGameOver(GameEndReason.AllHumansLost);
        }
        for (Player p : g.getRegisteredPlayers()) {
            if (p.getController() instanceof PlayerControllerHuman pch) {
                pch.getInputQueue().onGameOver(true);
            }
        }
    }

    private void concedeNow() {
        GameView gv = getGameView();
        if (gv == null || gv.isGameOver()) {
            return;
        }
        Game g = gv.getGame();
        // Conceding mutates the player lists, so it must not race the game thread (that crashed the match
        // during AI turns). Concede now only while the game thread is parked on us; otherwise the game thread
        // does it at its next phase change or its next wait for us.
        if (g != null && !gameThreadParked()) {
            synchronized (io) {
                if (concedeHooked != g) {
                    g.subscribeToEvents(concedeHook);
                    concedeHooked = g;
                }
            }
            concedePending = true;
            return;
        }
        concedeOnThisThread();
    }

    private boolean gameThreadParked() {
        List<CountDownLatch> waiting = List.copyOf(parked);
        boolean inAwait = !waiting.isEmpty() && waiting.stream().noneMatch(l -> l.getCount() == 0);
        synchronized (io) {
            return inAwait || open != null;
        }
    }

    private void concedeIfPending() {
        if (endPending) {
            endPending = false;
            endNow();
            return;
        }
        if (concedePending) {
            concedePending = false;
            concedeOnThisThread();
        }
    }

    private final Object concedeHook = new Object() {
        @Subscribe
        public void onPhase(GameEventTurnPhase e) {
            concedeIfPending();
        }
    };

    private void concedeOnThisThread() {
        GameView gv = getGameView();
        if (gv == null || gv.isGameOver()) {
            return;
        }
        for (IGameController c : getOriginalGameControllers()) {
            c.concede();
        }
        // With only AIs left the game would play on without anyone watching; end it the way AbstractGuiGame.concede
        // does. Another human still in the game keeps playing.
        Game g = gv.getGame();
        if (g != null) {
            g.getAction().invoke(() -> {
                if (!g.isGameOver() && g.getPlayers().stream().noneMatch(p -> !p.getController().isAI() && !p.hasLost())) {
                    g.setGameOver(GameEndReason.AllHumansLost);
                }
            });
        }
    }

    private PlayerView player(int id) {
        GameView gv = getGameView();
        if (gv == null) {
            return null;
        }
        for (PlayerView p : gv.getPlayers()) {
            if (p.getId() == id) {
                return p;
            }
        }
        return null;
    }

    private static String str(JsonObject o, String k, String d) {
        JsonElement e = o.get(k);
        return e != null && e.isJsonPrimitive() ? e.getAsString() : d;
    }

    private static ITriggerEvent trigger(JsonObject m) {
        int button = m.has("button") && m.get("button").isJsonPrimitive() ? m.get("button").getAsInt() : 1;
        return new ITriggerEvent() {
            @Override public int getButton() { return button; }
            @Override public int getX() { return 0; }
            @Override public int getY() { return 0; }
        };
    }

    // ---------------------------------------------------------------- asks

    private JsonObject newAsk(String kind) {
        JsonObject o = msg("ask");
        o.addProperty("id", 0);
        o.addProperty("kind", kind);
        return o;
    }

    /** Blocks the calling thread until the client answers. Null means no answer will ever come (match torn down). */
    private JsonElement ask(JsonObject body, Collection<CardView> cards) {
        if (disposed) {
            return null;
        }
        askLock.lock();
        try {
            decisionPoint();
            OpenAsk a;
            synchronized (io) {
                if (disposed) {
                    return null;
                }
                body.addProperty("id", ++askSeq);
                a = new OpenAsk(askSeq, body);
                askCards.clear();
                for (CardView c : cards) {
                    if (c != null) {
                        askCards.add(c);
                    }
                }
                flushLocked();
                open = a;
                sendLocked(body);
            }
            try {
                return a.answer.get();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            } catch (Exception e) {
                return null;
            } finally {
                synchronized (io) {
                    open = null;
                    askCards.clear();
                }
            }
        } finally {
            askLock.unlock();
        }
    }

    private <T> String label(T item, FSerializableFunction<T, String> display) {
        if (display != null) {
            try {
                return display.apply(item);
            } catch (Exception ignored) {
            }
        }
        if (item instanceof CardView cv) {
            return mayView(cv) ? cv.getCurrentState().getName() : "Hidden card";
        }
        if (item instanceof PlayerView pv) {
            return pv.getName();
        }
        if (item instanceof Byte b) {
            return MagicColor.toLongString(b);
        }
        return String.valueOf(item);
    }

    private <T> JsonArray items(List<T> list, FSerializableFunction<T, String> display, List<CardView> cardsOut) {
        JsonArray a = new JsonArray();
        for (int i = 0; i < list.size(); i++) {
            T item = list.get(i);
            JsonObject o = new JsonObject();
            o.addProperty("i", i);
            o.addProperty("label", label(item, display));
            o.add("ref", ViewProjector.ref(item));
            if (item instanceof CardView cv) {
                cardsOut.add(cv);
            }
            a.add(o);
        }
        return a;
    }

    /** Distinct indices in [0,n) with min <= count <= max, or null when the answer is unusable. */
    private static List<Integer> indices(JsonElement ans, int n, int min, int max) {
        if (ans == null || !ans.isJsonArray()) {
            return null;
        }
        List<Integer> out = new ArrayList<>();
        try {
            for (JsonElement e : ans.getAsJsonArray()) {
                int i = e.getAsInt();
                if (i < 0 || i >= n || out.contains(i)) {
                    return null;
                }
                out.add(i);
            }
        } catch (Exception e) {
            return null;
        }
        return out.size() < min || out.size() > max ? null : out;
    }

    private static List<Integer> firstN(int n) {
        List<Integer> l = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            l.add(i);
        }
        return l;
    }

    private <T> List<Integer> choose(String title, String message, int min, int max, List<T> choices, List<Integer> selected,
                                     FSerializableFunction<T, String> display) {
        int n = choices.size();
        int hi = max < 0 ? n : Math.min(max, n);
        int lo = Math.min(Math.max(0, min), hi);
        JsonObject body = newAsk("choose");
        body.addProperty("title", title == null ? "" : title);
        body.addProperty("message", message == null ? "" : message);
        body.addProperty("min", lo);
        body.addProperty("max", hi);
        List<CardView> cards = new ArrayList<>();
        body.add("items", items(choices, display, cards));
        JsonArray sel = new JsonArray();
        selected.forEach(sel::add);
        body.add("selected", sel);
        List<Integer> got = indices(ask(body, cards), n, lo, hi);
        if (got != null) {
            return got;
        }
        if (selected.size() >= lo && selected.size() <= hi) {
            return selected;
        }
        return firstN(lo);
    }

    private static <T> List<T> pick(List<T> from, List<Integer> idx) {
        List<T> out = new ArrayList<>(idx.size());
        for (int i : idx) {
            out.add(from.get(i));
        }
        return out;
    }

    private void sendReveal(String title, Iterable<CardView> cards) {
        JsonObject r = msg("reveal");
        r.addProperty("title", title == null ? "" : title);
        JsonArray ids = new JsonArray();
        synchronized (io) {
            revealCards.clear();
            if (cards != null) {
                for (CardView c : cards) {
                    if (c != null) {
                        revealCards.add(c);
                        ids.add(c.getId());
                    }
                }
            }
            r.add("cardIds", ids);
            flushLocked();
            lastReveal = ids.isEmpty() ? null : r;
            sendLocked(r);
        }
    }

    @Override
    public boolean clickToSelectFromLibrary() {
        return false;
    }

    @Override
    public <T> List<T> many(String title, String topCaption, int min, int max, List<T> sourceChoices, List<T> destChoices, CardView c) {
        // A subset of cards is a choose ask, returned in click order. Ordering every card, or the
        // unlimited (-1) reorder (scry, surveil, opening hand, contraptions), stays the order dialog.
        if (max >= 1 && sourceChoices != null && !sourceChoices.isEmpty()
                && !(min >= sourceChoices.size() && max >= sourceChoices.size())) {
            boolean cards = true;
            for (T item : sourceChoices) {
                if (!(item instanceof CardView)) {
                    cards = false;
                    break;
                }
            }
            if (cards) {
                return getChoices(title, min, max, sourceChoices);
            }
        }
        return super.many(title, topCaption, min, max, sourceChoices, destChoices, c);
    }

    @Override
    public <T> List<T> getChoices(String message, int min, int max, List<T> choices, List<T> selected, FSerializableFunction<T, String> display) {
        if (choices == null || choices.isEmpty()) {
            return new ArrayList<>();
        }
        if (min == -1 && max == -1) {
            // AbstractGuiGame.reveal: nothing to choose, just show
            List<CardView> cards = new ArrayList<>();
            List<String> labels = new ArrayList<>();
            for (T t : choices) {
                if (t instanceof CardView cv) {
                    cards.add(cv);
                } else {
                    labels.add(label(t, display));
                }
            }
            if (!cards.isEmpty()) {
                sendReveal(message, cards);
            }
            if (!labels.isEmpty()) {
                notice("info", message, String.join(", ", labels));
            }
            return new ArrayList<>();
        }
        List<Integer> sel = new ArrayList<>();
        if (selected != null) {
            for (T t : selected) {
                int i = choices.indexOf(t);
                if (i >= 0 && !sel.contains(i)) {
                    sel.add(i);
                }
            }
        }
        return pick(choices, choose(message, "", min, max, choices, sel, display));
    }

    @Override
    public <T> OrderResult<T> order(String title, String top, int remainingObjectsMin, int remainingObjectsMax, List<T> sourceChoices,
                                    List<T> destChoices, CardView referenceCard, boolean sideboardingMode, boolean showRememberCheckbox) {
        List<T> items = new ArrayList<>();
        if (destChoices != null) {
            items.addAll(destChoices);
        }
        items.addAll(sourceChoices);
        int n = sourceChoices.size();
        int d = items.size() - n;
        int max = remainingObjectsMin < 0 ? n : Math.max(0, Math.min(n, n - remainingObjectsMin));
        int min = remainingObjectsMax < 0 ? 0 : Math.max(0, Math.min(n, n - remainingObjectsMax));
        min = Math.min(min, max) + d;
        max += d;
        if (items.isEmpty()) {
            return new OrderResult<>(new ArrayList<>(), false);
        }
        JsonObject body = newAsk("order");
        body.addProperty("title", title == null ? "" : title);
        body.addProperty("message", top == null ? "" : top);
        body.addProperty("min", min);
        body.addProperty("max", max);
        List<CardView> cards = new ArrayList<>();
        body.add("items", items(items, null, cards));
        body.add("cardId", ViewProjector.id(referenceCard));
        if (referenceCard != null) {
            cards.add(referenceCard);
        }
        List<Integer> got = indices(ask(body, cards), items.size(), min, max);
        return new OrderResult<>(pick(items, got != null ? got : firstN(min)), false);
    }

    @Override
    public GameEntityView chooseSingleEntityForEffect(String title, List<? extends GameEntityView> optionList, DelayedReveal delayedReveal, boolean isOptional) {
        if (delayedReveal != null && !delayedReveal.getCards().isEmpty()) {
            sendReveal(delayedReveal.getMessagePrefix(), delayedReveal.getCards());
        }
        if (optionList == null || optionList.isEmpty()) {
            return null;
        }
        List<GameEntityView> list = new ArrayList<>(optionList);
        List<Integer> got = choose(title, "", isOptional ? 0 : 1, 1, list, Collections.emptyList(), null);
        return got.isEmpty() ? null : list.get(got.get(0));
    }

    @Override
    public List<GameEntityView> chooseEntitiesForEffect(String title, List<? extends GameEntityView> optionList, int min, int max, DelayedReveal delayedReveal) {
        if (delayedReveal != null && !delayedReveal.getCards().isEmpty()) {
            sendReveal(delayedReveal.getMessagePrefix(), delayedReveal.getCards());
        }
        if (optionList == null || optionList.isEmpty()) {
            return new ArrayList<>();
        }
        List<GameEntityView> list = new ArrayList<>(optionList);
        return pick(list, choose(title, "", min, max, list, Collections.emptyList(), null));
    }

    @Override
    public List<CardView> manipulateCardList(String title, Iterable<CardView> cards, Iterable<CardView> manipulable, boolean toTop, boolean toBottom, boolean toAnywhere) {
        List<CardView> all = new ArrayList<>();
        cards.forEach(all::add);
        JsonObject body = newAsk("arrange");
        body.addProperty("title", title == null ? "" : title);
        JsonArray ids = new JsonArray();
        all.forEach(c -> ids.add(c.getId()));
        body.add("cardIds", ids);
        JsonArray mids = new JsonArray();
        if (manipulable != null) {
            manipulable.forEach(c -> mids.add(c.getId()));
        }
        body.add("manipulableIds", mids);
        body.addProperty("toTop", toTop);
        body.addProperty("toBottom", toBottom);
        body.addProperty("toAnywhere", toAnywhere);
        JsonElement ans = ask(body, all);
        if (ans != null && ans.isJsonArray() && ans.getAsJsonArray().size() == all.size()) {
            Map<Integer, CardView> byId = new HashMap<>();
            all.forEach(c -> byId.put(c.getId(), c));
            List<CardView> out = new ArrayList<>();
            try {
                for (JsonElement e : ans.getAsJsonArray()) {
                    CardView c = byId.remove(e.getAsInt());
                    if (c == null) {
                        return all;
                    }
                    out.add(c);
                }
                return out;
            } catch (Exception ignored) {
            }
        }
        return all;
    }

    @Override
    public Map<CardView, Integer> assignCombatDamage(CardView attacker, List<CardView> blockers, int damage, GameEntityView defender, boolean overrideOrder, boolean maySkip) {
        JsonObject body = newAsk("damage");
        body.addProperty("attackerId", attacker.getId());
        JsonArray bids = new JsonArray();
        blockers.forEach(b -> bids.add(b.getId()));
        body.add("blockerIds", bids);
        body.addProperty("damage", damage);
        body.add("defender", ViewProjector.ref(defender));
        body.addProperty("overrideOrder", overrideOrder);
        body.addProperty("maySkip", maySkip);
        List<CardView> cards = new ArrayList<>(blockers);
        cards.add(attacker);
        if (defender instanceof CardView dc) {
            cards.add(dc);
        }
        JsonElement ans = ask(body, cards);
        if (ans != null && ans.isJsonNull() && maySkip) {
            return null;
        }
        if (ans != null && ans.isJsonObject()) {
            Map<CardView, Integer> out = new HashMap<>();
            String defKey = defender instanceof CardView dc ? "card:" + dc.getId() : defender instanceof PlayerView dp ? "player:" + dp.getId() : null;
            int sum = 0;
            boolean ok = true;
            try {
                for (Map.Entry<String, JsonElement> e : ans.getAsJsonObject().entrySet()) {
                    int v = e.getValue().getAsInt();
                    if (v < 0) {
                        ok = false;
                        break;
                    }
                    if (v == 0) {
                        continue;
                    }
                    CardView target = null;
                    boolean found = false;
                    for (CardView b : blockers) {
                        if (e.getKey().equals("card:" + b.getId())) {
                            target = b;
                            found = true;
                        }
                    }
                    if (!found && e.getKey().equals(defKey)) {
                        found = true; // null key = the defender, as PlayerControllerHuman expects
                    }
                    if (!found) {
                        ok = false;
                        break;
                    }
                    out.merge(target, v, Integer::sum);
                    sum += v;
                }
            } catch (Exception ex) {
                ok = false;
            }
            if (ok && sum == damage) {
                return out;
            }
        }
        Map<CardView, Integer> dflt = new HashMap<>();
        dflt.put(blockers.isEmpty() ? null : blockers.get(0), damage);
        return dflt;
    }

    @Override
    public Map<Object, Integer> assignGenericAmount(CardView effectSource, Map<Object, Integer> target, int amount, boolean atLeastOne, String amountLabel) {
        List<Object> keys = new ArrayList<>(target.keySet());
        JsonObject body = newAsk("amount");
        body.add("sourceCardId", ViewProjector.id(effectSource));
        body.addProperty("amount", amount);
        body.addProperty("atLeastOne", atLeastOne);
        body.addProperty("label", amountLabel == null ? "" : amountLabel);
        List<CardView> cards = new ArrayList<>();
        body.add("items", items(keys, null, cards));
        if (effectSource != null) {
            cards.add(effectSource);
        }
        JsonElement ans = ask(body, cards);
        if (ans != null && ans.isJsonObject()) {
            Map<Object, Integer> out = new LinkedHashMap<>();
            keys.forEach(k -> out.put(k, 0));
            int sum = 0;
            boolean ok = true;
            try {
                for (Map.Entry<String, JsonElement> e : ans.getAsJsonObject().entrySet()) {
                    int i = Integer.parseInt(e.getKey());
                    int v = e.getValue().getAsInt();
                    if (i < 0 || i >= keys.size() || v < 0) {
                        ok = false;
                        break;
                    }
                    out.put(keys.get(i), v);
                    sum += v;
                }
            } catch (Exception ex) {
                ok = false;
            }
            if (ok && atLeastOne) {
                for (int v : out.values()) {
                    if (v < 1) {
                        ok = false;
                    }
                }
            }
            if (ok && sum == amount) {
                return out;
            }
        }
        Map<Object, Integer> dflt = new LinkedHashMap<>();
        int n = keys.size();
        for (int i = 0; i < n; i++) {
            dflt.put(keys.get(i), amount / n + (i < amount % n ? 1 : 0));
        }
        return dflt;
    }

    @Override
    public SpellAbilityView getAbilityToPlay(CardView hostCard, List<SpellAbilityView> abilities, ITriggerEvent triggerEvent) {
        if (abilities.isEmpty()) {
            return null;
        }
        if (abilities.size() == 1 && (triggerEvent == null || !abilities.get(0).promptIfOnlyPossibleAbility())) {
            return triggerEvent == null || abilities.get(0).canPlay() ? abilities.get(0) : null;
        }
        JsonObject body = newAsk("ability");
        body.addProperty("cardId", hostCard.getId());
        JsonArray items = new JsonArray();
        for (int i = 0; i < abilities.size(); i++) {
            SpellAbilityView sa = abilities.get(i);
            JsonObject o = new JsonObject();
            o.addProperty("i", i);
            String s = sa.toString();
            o.addProperty("label", s.contains("\n") ? s.substring(0, s.indexOf('\n')) : s);
            o.add("ref", JsonNull.INSTANCE);
            o.addProperty("enabled", sa.canPlay());
            items.add(o);
        }
        body.add("items", items);
        JsonElement ans = ask(body, List.of(hostCard));
        try {
            if (ans != null && !ans.isJsonNull()) {
                int i = ans.getAsInt();
                if (i >= 0 && i < abilities.size() && abilities.get(i).canPlay()) {
                    return abilities.get(i);
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private int optionAsk(String kind, String title, String message, CardView card, List<String> options, int defaultIndex) {
        JsonObject body = newAsk(kind);
        body.addProperty("title", title == null ? "" : title);
        body.addProperty("message", message == null ? "" : message);
        if (kind.equals("confirm")) {
            body.add("cardId", ViewProjector.id(card));
        }
        JsonArray opts = new JsonArray();
        options.forEach(opts::add);
        body.add("options", opts);
        body.addProperty("defaultIndex", defaultIndex);
        JsonElement ans = ask(body, card == null ? List.of() : List.of(card));
        try {
            if (ans != null && !ans.isJsonNull()) {
                int i = ans.getAsInt();
                if (i >= 0 && i < options.size()) {
                    return i;
                }
            }
        } catch (Exception ignored) {
        }
        return defaultIndex;
    }

    @Override
    public boolean confirm(CardView c, String question, boolean defaultIsYes, List<String> options) {
        List<String> opts = options == null || options.isEmpty() ? InputConfirm.defaultOptions : options;
        int dflt = defaultIsYes || opts.size() < 2 ? 0 : 1;
        return optionAsk("confirm", c == null ? "" : label(c, null), question, c, opts, dflt) == 0;
    }

    @Override
    public boolean showConfirmDialog(String message, String title, String yesButtonText, String noButtonText, boolean defaultYes) {
        return optionAsk("confirm", title, message, null, List.of(yesButtonText, noButtonText), defaultYes ? 0 : 1) == 0;
    }

    @Override
    public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) {
        if (options == null || options.isEmpty()) {
            return -1;
        }
        return optionAsk("option", title, message, null, options, Math.max(0, Math.min(defaultOption, options.size() - 1)));
    }

    @Override
    public String showInputDialog(String message, String title, FSkinProp icon, String initialInput, List<String> inputOptions, boolean isNumeric) {
        JsonObject body = newAsk("input");
        body.addProperty("title", title == null ? "" : title);
        body.addProperty("message", message == null ? "" : message);
        body.addProperty("initial", initialInput == null ? "" : initialInput);
        if (inputOptions == null) {
            body.add("options", JsonNull.INSTANCE);
        } else {
            JsonArray opts = new JsonArray();
            inputOptions.forEach(opts::add);
            body.add("options", opts);
        }
        body.addProperty("numeric", isNumeric);
        JsonElement ans = ask(body, List.of());
        if (ans == null) {
            return initialInput;
        }
        if (ans.isJsonNull()) {
            return null;
        }
        try {
            String s = ans.getAsString();
            if (inputOptions != null && !inputOptions.contains(s)) {
                return initialInput;
            }
            if (isNumeric) {
                Integer.parseInt(s.trim());
                s = s.trim();
            }
            return s;
        } catch (Exception e) {
            return initialInput;
        }
    }

    @Override
    public void message(String message, String title) {
        notice("info", title, message);
    }

    @Override
    public void showErrorDialog(String message, String title) {
        notice("error", title, message);
    }

    @Override
    public List<PaperCard> sideboard(CardPool sideboard, CardPool main, String message) {
        return main.toFlatList();
    }

    // ---------------------------------------------------------------- non-blocking UI

    @Override
    protected void updateCurrentPlayer(PlayerView player) {
    }

    @Override
    public void setGameView(GameView gameView0) {
        super.setGameView(gameView0);
        if (gameView0 == null) {
            synchronized (io) {
                forceFull = true;
            }
        }
        dirty();
    }

    @Override
    public void openView(TrackableCollection<PlayerView> myPlayers) {
        dirty();
    }

    @Override
    public void afterGameEnd() {
        super.afterGameEnd();
        OpenAsk a = open;
        if (a != null) {
            a.answer.complete(null);
        }
    }

    @Override
    public void showPromptMessage(PlayerView playerView, String message, CardView card) {
        cancelWaitingTimer();
        JsonObject p = msg("prompt");
        p.add("playerId", ViewProjector.id(playerView));
        p.addProperty("message", message == null ? "" : message);
        p.add("cardId", ViewProjector.id(card));
        synchronized (io) {
            lastPrompt = p;
            promptCard = card;
            flushLocked();
            sendLocked(p);
        }
        // inputs re-prompt after every click that changes them (e.g. a blocker assigned)
        decisionPoint();
        armRespondTimer();
    }

    /**
     * Every prompt ends the last timer; one that is priority while responding starts a new one. When it runs
     * out and that same prompt is still open, priority passes as if OK were clicked (on WebEdt, where clicks run).
     */
    private void armRespondTimer() {
        int seconds = respondSeconds;
        PlayerControllerHuman human = null;
        InputPassPriority priority = null;
        Game game = match.getGame();
        Player seat = seconds > 0 && !disposed ? seat(game) : null;
        if (seat != null && seat.getController() instanceof PlayerControllerHuman h
                && h.getInputQueue().getInput() instanceof InputPassPriority pp) {
            boolean responding = !game.getStack().isEmpty() || game.getPhaseHandler().getPlayerTurn() != seat;
            if (responding) {
                human = h;
                priority = pp;
            }
        }
        synchronized (io) {
            boolean wasArmed = respondTimer != null;
            if (respondTimer != null) {
                respondTimer.cancel(false);
                respondTimer = null;
            }
            if (priority == null) {
                if (wasArmed) {
                    JsonObject t = msg("timer");
                    t.add("seconds", JsonNull.INSTANCE);
                    sendLocked(t);
                }
                return;
            }
            PlayerControllerHuman h = human;
            InputPassPriority pp = priority;
            respondPass = () -> WebEdt.invokeLater(() -> {
                if (!disposed && h.getInputQueue().getInput() == pp) {
                    pp.passPriority();
                }
            });
            scheduleRespondLocked(seconds * 1000L);
        }
    }

    // io held
    private void scheduleRespondLocked(long ms) {
        respondDeadline = System.currentTimeMillis() + ms;
        respondTimer = RESPOND.schedule(respondPass, ms, TimeUnit.MILLISECONDS);
        JsonObject t = msg("timer");
        t.addProperty("seconds", (ms + 999) / 1000);
        sendLocked(t);
    }

    /** "In response": the player is answering and wants longer. Adds MORE_SECONDS to the running timer, if any. */
    private void moreTime() {
        synchronized (io) {
            if (respondTimer == null || !respondTimer.cancel(false)) {
                return;
            }
            long left = Math.max(0, respondDeadline - System.currentTimeMillis());
            scheduleRespondLocked(left + MORE_SECONDS * 1000L);
        }
    }

    @Override
    public void updateButtons(PlayerView owner, String label1, String label2, boolean enable1, boolean enable2, boolean focus1) {
        JsonObject b = msg("buttons");
        b.add("playerId", ViewProjector.id(owner));
        JsonObject ok = new JsonObject();
        ok.addProperty("label", label1 == null ? "" : label1);
        ok.addProperty("enabled", enable1);
        b.add("ok", ok);
        JsonObject cancel = new JsonObject();
        cancel.addProperty("label", label2 == null ? "" : label2);
        cancel.addProperty("enabled", enable2);
        b.add("cancel", cancel);
        b.addProperty("focusOk", focus1);
        synchronized (io) {
            lastButtons = b;
            flushLocked();
            sendLocked(b);
        }
    }

    private void sendSelectables(int min, int max) {
        synchronized (io) {
            selectMin = min;
            selectMax = max;
            sendSelectablesLocked();
        }
    }

    private void sendSelectablesLocked() {
        JsonObject s = msg("selectables");
        JsonArray ids = new JsonArray();
        selectCards.forEach(c -> ids.add(c.getId()));
        s.add("cardIds", ids);
        JsonArray pids = new JsonArray();
        selectPlayers.forEach(pids::add);
        s.add("playerIds", pids);
        s.addProperty("min", selectMin);
        s.addProperty("max", selectMax);
        lastSelectables = ids.isEmpty() && pids.isEmpty() ? null : s;
        flushLocked();
        sendLocked(s);
    }

    @Override
    public void setSelectables(Iterable<CardView> cards, int min, int max) {
        super.setSelectables(cards, min, max);
        synchronized (io) {
            for (CardView c : cards) {
                if (c != null) {
                    selectCards.add(c);
                }
            }
        }
        sendSelectables(min, max);
    }

    @Override
    public void clearSelectables() {
        super.clearSelectables();
        synchronized (io) {
            if (selectCards.isEmpty() && lastSelectables == null) {
                return;
            }
            selectCards.clear();
            selectPlayers = List.of();
        }
        sendSelectables(0, 0);
    }

    @Override
    public void setHighlighted(Iterable<GameEntityView> entities, boolean b) {
        List<GameEntityView> list = new ArrayList<>();
        entities.forEach(list::add);
        super.setHighlighted(list, b);
        JsonObject h = msg("highlight");
        JsonArray a = new JsonArray();
        synchronized (io) {
            for (GameEntityView e : list) {
                JsonElement r = ViewProjector.ref(e);
                if (!r.isJsonObject()) {
                    continue;
                }
                a.add(r);
                String key = r.toString();
                if (b) {
                    highlighted.put(key, r.getAsJsonObject());
                    if (e instanceof CardView cv) {
                        highlightCards.add(cv);
                    }
                } else {
                    highlighted.remove(key);
                    if (e instanceof CardView cv) {
                        highlightCards.remove(cv);
                    }
                }
            }
            if (a.isEmpty()) {
                return;
            }
            h.add("entities", a);
            h.addProperty("on", b);
            flushLocked();
            sendLocked(h);
        }
    }

    private void sendPlayable(Iterable<CardView> cards) {
        JsonObject p = msg("playable");
        JsonArray ids = new JsonArray();
        Set<Integer> seen = new HashSet<>();
        if (cards != null) {
            for (CardView c : cards) {
                if (c != null && seen.add(c.getId())) {
                    ids.add(c.getId());
                }
            }
        }
        p.add("cardIds", ids);
        synchronized (io) {
            if (ids.isEmpty() && lastPlayable == null) {
                return;
            }
            lastPlayable = ids.isEmpty() ? null : p;
            flushLocked();
            sendLocked(p);
        }
    }

    @Override
    public void setWeaklySelectable(Iterable<CardView> cards) {
        List<CardView> list = new ArrayList<>();
        cards.forEach(list::add);
        super.setWeaklySelectable(list);
        sendPlayable(list);
    }

    @Override
    public void clearWeaklySelectable() {
        super.clearWeaklySelectable();
        sendPlayable(null);
    }

    @Override
    public void showRevealedCards(Iterable<CardView> cards) {
        sendReveal("", cards);
    }

    @Override
    public void hideRevealedCards() {
        synchronized (io) {
            if (lastReveal == null) {
                return;
            }
        }
        sendReveal("", null);
    }

    @Override
    public void flashIncorrectAction() {
        notice("flash", "", "");
    }

    @Override
    public void alertUser() {
    }

    private volatile JsonObject outcome;

    /** Winner, turn, summary and log. Frozen when the game ends, so the play log can outlive the match. */
    JsonObject outcome() {
        JsonObject saved = outcome;
        return saved != null ? saved : readOutcome();
    }

    private JsonObject readOutcome() {
        JsonObject o = new JsonObject();
        try {
            GameView gv = getGameView();
            if (gv == null) {
                return o;
            }
            o.addProperty("gameOver", gv.isGameOver());
            String winner = gv.getWinningPlayerName();
            if (winner != null) {
                o.addProperty("winner", winner);
            }
            o.addProperty("turn", gv.getTurn());
            o.addProperty("summary", winner == null ? "The game is a draw" : winner + " won on turn " + gv.getTurn());
            GameLog gl = gv.getGameLog();
            JsonArray log = new JsonArray();
            if (gl != null) {
                // the whole game: the tracker keeps it as the game's history
                for (GameLogEntry e : gl.getAllEntries()) {
                    log.add(e.toString());
                }
            }
            o.add("log", log);
        } catch (RuntimeException e) {
            e.printStackTrace();
        }
        return o;
    }

    @Override
    public void finishGame() {
        JsonObject saved = readOutcome();
        saved.addProperty("gameOver", true);
        outcome = saved;
        GameView gv = getGameView();
        JsonObject g = msg("gameOver");
        String winner = gv == null ? null : gv.getWinningPlayerName();
        g.addProperty("winner", winner);
        g.addProperty("summary", winner == null ? "The game is a draw" : winner + " won on turn " + gv.getTurn());
        sendUi(g);
        WebEdt.invokeLater(() -> {
            for (IGameController c : getOriginalGameControllers()) {
                c.nextGameDecision(NextGameDecision.QUIT);
            }
        });
    }

    @Override
    public boolean isUiSetToSkipPhase(PlayerView playerTurn, PhaseType phase) {
        boolean mine = playerTurn != null && isLocalPlayer(playerTurn);
        boolean stop = mine
                ? phase == PhaseType.MAIN1 || phase == PhaseType.COMBAT_DECLARE_ATTACKERS || phase == PhaseType.MAIN2
                : phase == PhaseType.COMBAT_DECLARE_BLOCKERS || phase == PhaseType.END_OF_TURN;
        return !stop;
    }

    @Override
    public void showCombat() {
        dirty();
    }

    @Override
    public void updatePhase(boolean saveState) {
        dirty();
    }

    @Override
    public void updateTurn(PlayerView player) {
        dirty();
    }

    @Override
    public void updatePlayerControl() {
        dirty();
    }

    @Override
    public void updateStack() {
        dirty();
    }

    @Override
    public void notifyStackAddition(GameEventSpellAbilityCast event) {
        dirty();
    }

    @Override
    public void notifyStackRemoval(GameEventSpellRemovedFromStack event) {
        dirty();
    }

    @Override
    public void handleLandPlayed(CardView land) {
        dirty();
    }

    @Override
    public void handleGameEvent(GameEvent event) {
        dirty();
    }

    @Override
    public void updateZones(Iterable<PlayerZoneUpdate> zonesToUpdate) {
        dirty();
    }

    @Override
    public void updateCards(Iterable<CardView> cards) {
        dirty();
    }

    @Override
    public void refreshCardDetails(Iterable<CardView> cards) {
        dirty();
    }

    @Override
    public void refreshField() {
        dirty();
    }

    @Override
    public void updateManaPool(Iterable<PlayerView> manaPoolUpdate) {
        dirty();
    }

    @Override
    public void updateLives(Iterable<PlayerView> livesUpdate) {
        dirty();
    }

    @Override
    public void updateShards(Iterable<PlayerView> shardsUpdate) {
        dirty();
    }

    @Override
    public void updateDependencies() {
        dirty();
    }

    @Override
    public void updateRevealedCards(TrackableCollection<CardView> collection) {
        super.updateRevealedCards(collection);
        dirty();
    }

    @Override
    public GameState getGamestate() {
        return null;
    }

    @Override
    public void setPanelSelection(CardView hostCard) {
    }

    @Override
    public void setCard(CardView card) {
    }

    @Override
    public void setPlayerAvatar(LobbyPlayer player, IHasIcon ihi) {
    }

    HostedMatch hostedMatch() {
        return match;
    }
}
