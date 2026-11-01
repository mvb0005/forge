package forge.web;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import forge.deck.Deck;
import forge.game.GameRules;
import forge.game.GameState;
import forge.game.GameType;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.gui.interfaces.IGuiGame;
import forge.player.GamePlayerUtil;
import forge.player.LobbyPlayerHuman;
import forge.web.assist.Assists;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * The one table this game server hosts (docs/MULTIPLAYER.md D-M1). A match is started through the control
 * API from a spec; each human seat gets a ticket, and a browser takes its seat by connecting with it. Who the
 * people are, their decks and the game history belong to whoever called the control API (mtg-tracker).
 */
public final class MatchHost {
    /** This socket was closed because the same seat connected again. */
    static final int SEAT_REPLACED = 4001;
    /** No seat here for this ticket: no ticket, an old one, or a different match. */
    static final int NO_SEAT = 4004;
    static final int SPEC_VERSION = 1;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern MATCH_ID = Pattern.compile("[0-9a-f]{16}");

    enum State { IDLE, PLAYING, FINISHED }

    /** A seat at the current match. Humans have a ticket and their own session; AIs have neither. */
    private static final class Seat {
        final int index;
        final boolean human;
        final String name;
        final String person;
        final String deckName;
        final String ticket;
        WebGuiGame session;
        Recorder recorder;
        volatile ClientChannel channel;

        Seat(int index, boolean human, String name, String person, String deckName) {
            this.index = index;
            this.human = human;
            this.name = name;
            this.person = person;
            this.deckName = deckName;
            this.ticket = human ? HexFormat.of().formatHex(bytes(16)) : null;
        }

        private static byte[] bytes(int n) {
            byte[] b = new byte[n];
            RANDOM.nextBytes(b);
            return b;
        }
    }

    private final Path repoRoot;
    private final ResultsSender results;
    private final Object lock = new Object();
    // guarded by lock
    private State state = State.IDLE;
    private String matchId;
    private String format;
    private String returnUrl;
    private String resultsUrl;
    private String replayUrl;
    private Instant startedAt;
    private List<Seat> seats = List.of();
    private JsonObject result;
    private boolean ending;
    private boolean abandoning;
    /** When a human was last at the table, or the match started. */
    private Instant lastSeen;
    private Instant finishedAt;

    public MatchHost(Path repoRoot, ResultsSender results) {
        this.repoRoot = repoRoot;
        this.results = results;
        Decks.warmUp();
    }

    /**
     * A table pod hosts one match (docs/MULTIPLAYER.md D-M9): no humans for {@code abandon} ends it as abandoned, and
     * {@code linger} after it's over (results sent, the board still viewable) the server exits. Until a match
     * starts it waits as a spare, for as long as it takes.
     */
    void oneMatch(Duration linger, Duration abandon) {
        oneMatch = true;
        ScheduledExecutorService tick = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "One match");
            t.setDaemon(true);
            return t;
        });
        tick.scheduleWithFixedDelay(() -> {
            String id;
            synchronized (lock) {
                Instant now = Instant.now();
                if (state == State.FINISHED && now.isAfter(finishedAt.plus(linger))) {
                    System.out.println("Match " + matchId + " is over; this table closes");
                    System.exit(0);
                }
                if (state != State.PLAYING || ending) {
                    return;
                }
                if (seats.stream().anyMatch(s -> s.human && s.channel != null)) {
                    lastSeen = now;
                    return;
                }
                if (!now.isAfter(lastSeen.plus(abandon))) {
                    return;
                }
                abandoning = true;
                id = matchId;
            }
            System.out.println("Nobody has been at match " + id + " for " + abandon.toMinutes() + " minutes; ending it");
            end(id);
        }, 15, 15, TimeUnit.SECONDS);
    }

    private volatile boolean oneMatch;

    // ---------------------------------------------------------------- players' sockets

    /** The optional features this server has (PROTOCOL.md "hello"). */
    private static JsonArray caps() {
        JsonArray caps = new JsonArray();
        for (String c : new String[] {"log.append", "selectables.players", "match.commander", "card.basePT", "card.keywordLabels",
                "player.colorIdentity", "player.commander", "game.turnOrder", "timer.respond"}) {
            caps.add(c);
        }
        Assists.standard().caps().forEach(caps::add);
        return caps;
    }

    /** A seat's socket. {@code table} is the match id from the page's path (/play/table/&lt;id&gt;/), or null at the bare path. */
    void onConnect(ClientChannel ch, String ticket, String table) {
        Seat seat;
        ClientChannel previous;
        State st;
        String back;
        synchronized (lock) {
            seat = ticket == null ? null : seats.stream().filter(s -> ticket.equals(s.ticket)).findFirst().orElse(null);
            if (table != null && !table.equals(matchId)) {
                ch.close(NO_SEAT, "That game isn't running here any more. Start or rejoin one from the tracker.");
                return;
            }
            if (seat == null) {
                ch.close(NO_SEAT, "There's no seat here for this link. Start a game from the tracker.");
                return;
            }
            previous = seat.channel;
            seat.channel = ch;
            st = state;
            back = returnUrl;
        }
        JsonObject hello = new JsonObject();
        hello.addProperty("t", "hello");
        hello.addProperty("version", 2);
        hello.addProperty("seat", seat.index);
        hello.addProperty("who", seat.name);
        if (back != null) {
            hello.addProperty("returnUrl", back);
        }
        hello.add("caps", caps());
        hello.addProperty("inMatch", st == State.PLAYING);
        ch.send(hello);
        if (st == State.PLAYING && seat.session != null) {
            seat.session.onConnect(ch);
        } else if (st == State.FINISHED) {
            JsonObject over = new JsonObject();
            over.addProperty("t", "ended");
            synchronized (lock) {
                if (result != null && result.has("summary")) {
                    over.add("summary", result.get("summary"));
                }
            }
            ch.send(over);
        }
        if (previous != null && previous != ch) {
            previous.close(SEAT_REPLACED, "This seat connected in another window");
        }
    }

    void onDisconnect(ClientChannel ch) {
        Seat seat = seatOf(ch);
        if (seat == null) {
            return;
        }
        synchronized (lock) {
            if (seat.channel != ch) {
                return;
            }
            seat.channel = null;
        }
        WebGuiGame s = seat.session;
        if (s != null) {
            s.onDisconnect(ch);
        }
    }

    void onMessage(ClientChannel ch, JsonObject msg) {
        Seat seat = seatOf(ch);
        WebGuiGame s = seat == null ? null : seat.session;
        String t = msg.has("t") && msg.get("t").isJsonPrimitive() ? msg.get("t").getAsString() : "";
        if (s == null) {
            System.err.println("Ignoring " + t + " outside a match");
        } else if (t.equals("answer")) {
            s.onClientMessage(msg); // completes a blocked ask; never queued behind it on WebEdt
        } else {
            WebEdt.invokeLater(() -> {
                try {
                    s.onClientMessage(msg);
                } catch (Exception e) {
                    e.printStackTrace();
                    JsonObject o = new JsonObject();
                    o.addProperty("t", "error");
                    o.addProperty("message", "Error handling " + t + ": " + e);
                    ch.send(o);
                }
            });
        }
    }

    private Seat seatOf(ClientChannel ch) {
        synchronized (lock) {
            for (Seat s : seats) {
                if (s.channel == ch) {
                    return s;
                }
            }
        }
        return null;
    }

    // ---------------------------------------------------------------- control API

    /** Thrown for a spec this server won't start; the message is written for the people at the table. */
    static final class Refused extends RuntimeException {
        final int status;

        Refused(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    /** Starts a match from a spec (PROTOCOL.md "Control API"). Returns the match id and each seat's ticket. */
    JsonObject start(JsonObject spec) {
        JsonObject[] out = new JsonObject[1];
        RuntimeException[] failed = new RuntimeException[1];
        WebEdt.invokeAndWait(() -> {
            try {
                out[0] = startOnEdt(spec);
            } catch (RuntimeException e) {
                failed[0] = e;
            }
        });
        if (failed[0] != null) {
            throw failed[0];
        }
        return out[0];
    }

    private JsonObject startOnEdt(JsonObject spec) {
        synchronized (lock) {
            if (state == State.PLAYING) {
                throw new Refused(409, "A game is already running here");
            }
            if (oneMatch && state == State.FINISHED) {
                throw new Refused(409, "This table's game is over");
            }
        }
        String id = str(spec, "matchId", null);
        if (id == null) {
            id = HexFormat.of().formatHex(Seat.bytes(8));
        } else if (!MATCH_ID.matcher(id).matches()) {
            throw new Refused(400, "A match id is 16 lowercase hex characters");
        }
        int version = spec.has("version") ? spec.get("version").getAsInt() : -1;
        if (version != SPEC_VERSION) {
            throw new Refused(400, "Spec version " + version + " is not " + SPEC_VERSION);
        }
        String fmt = str(spec, "format", "commander");
        boolean commander = fmt.equals("commander");
        if (!commander && !fmt.equals("constructed")) {
            throw new Refused(400, "Unknown format " + fmt);
        }
        JsonArray seatSpecs = spec.has("seats") && spec.get("seats").isJsonArray() ? spec.getAsJsonArray("seats") : new JsonArray();
        String stateName = str(spec, "state", null);
        GameState gameState = stateName == null ? null : loadState(stateName);
        if (gameState != null && seatSpecs.isEmpty()) {
            // A saved board with no seats named: you are its first player, AIs the rest.
            for (int i = 0; i < gameState.getPlayerCount(); i++) {
                JsonObject seat = new JsonObject();
                seat.addProperty("kind", i == 0 ? "human" : "ai");
                seatSpecs.add(seat);
            }
        }
        if (seatSpecs.size() < 2 || seatSpecs.size() > 4) {
            throw new Refused(400, "A game needs 2 to 4 seats");
        }
        if (gameState != null && gameState.getPlayerCount() != seatSpecs.size()) {
            throw new Refused(400, stateName + " has " + gameState.getPlayerCount() + " players, not " + seatSpecs.size());
        }
        if (gameState != null) {
            commander = readState(stateName).contains("IsCommander"); // the board decides, as SimulateMatch -state does
        }

        Set<GameType> variants = commander ? EnumSet.of(GameType.Commander) : null;
        List<Seat> newSeats = new ArrayList<>();
        List<RegisteredPlayer> players = new ArrayList<>();
        Set<String> names = new HashSet<>();
        Set<String> preconsTaken = new HashSet<>();
        int humans = 0;
        for (int i = 0; i < seatSpecs.size(); i++) {
            JsonObject s = seatSpecs.get(i).getAsJsonObject();
            boolean human = "human".equals(str(s, "kind", ""));
            if (!human && !"ai".equals(str(s, "kind", ""))) {
                throw new Refused(400, "Seat " + (i + 1) + " is neither human nor ai");
            }
            humans += human ? 1 : 0;
            Opponents.Opponent curated = human ? null : Opponents.byId(str(s, "opponent", ""));
            if (!human && s.has("opponent") && curated == null) {
                throw new Refused(400, "Unknown opponent " + str(s, "opponent", ""));
            }
            Deck deck = gameState != null ? new Deck() : deckFor(s, human, commander, curated, preconsTaken, i);
            String name = str(s, "name", null);
            if (name == null || name.isBlank()) {
                name = curated != null ? curated.commander().split(",")[0] : human ? "Player " + (i + 1) : "AI " + i;
            }
            name = unique(name.trim(), names);

            RegisteredPlayer rp = commander && gameState == null
                    ? RegisteredPlayer.forVariants(seatSpecs.size(), variants, deck, null, false, null, null)
                    : new RegisteredPlayer(deck);
            if (human) {
                rp.setPlayer(new LobbyPlayerHuman(name));
            } else {
                String profile = curated != null ? curated.profile() : str(s, "profile", null);
                rp.setPlayer(profile == null ? GamePlayerUtil.createAiPlayer(name, i) : GamePlayerUtil.createAiPlayer(name, i, 0, null, profile));
            }
            if (gameState != null) {
                rp.setStartingHand(0);
            }
            players.add(rp);
            String deckName = gameState != null ? stateName : curated != null ? curated.precon() : Decks.shortName(deck);
            newSeats.add(new Seat(i, human, name, str(s, "person", null), deckName));
        }
        if (humans == 0) {
            throw new Refused(400, "A game needs at least one human seat");
        }

        HostedMatch match = new HostedMatch();
        Map<RegisteredPlayer, IGuiGame> guis = new LinkedHashMap<>();
        for (int i = 0; i < newSeats.size(); i++) {
            Seat seat = newSeats.get(i);
            if (seat.human) {
                seat.session = new WebGuiGame(match);
                guis.put(players.get(i), seat.session.gui());
            }
        }
        String started = id;
        synchronized (lock) {
            matchId = id;
            format = commander ? "commander" : "constructed";
            returnUrl = str(spec, "returnUrl", null);
            resultsUrl = str(spec, "resultsUrl", null);
            replayUrl = str(spec, "replayUrl", null);
            startedAt = Instant.now();
            seats = List.copyOf(newSeats);
            result = null;
            ending = false;
            abandoning = false;
            lastSeen = startedAt;
            state = State.PLAYING;
        }
        if (replayUrl != null) {
            JsonArray seatsOut = new JsonArray();
            for (Seat s : newSeats) {
                JsonObject j = new JsonObject();
                j.addProperty("index", s.index);
                j.addProperty("kind", s.human ? "human" : "ai");
                j.addProperty("name", s.name);
                j.addProperty("deck", s.deckName);
                seatsOut.add(j);
            }
            for (Seat s : newSeats) {
                if (s.session == null) {
                    continue;
                }
                JsonObject header = new JsonObject();
                header.addProperty("matchId", id);
                header.addProperty("seat", s.index);
                header.addProperty("who", s.name);
                header.addProperty("version", 2);
                header.add("caps", caps());
                header.addProperty("format", commander ? "commander" : "constructed");
                header.addProperty("startedAt", startedAt.toString());
                header.add("seats", seatsOut);
                s.recorder = new Recorder(header);
                s.session.record(s.recorder);
            }
        }
        if (gameState != null) {
            match.setStartGameHook(() -> gameState.applyToGameNow(match.getGame()));
        }
        match.setOnMatchOver(() -> finished(started));
        GameRules rules = new GameRules(commander ? GameType.Commander : GameType.Constructed);
        rules.setGamesPerMatch(1);
        try {
            match.startMatch(rules, variants, players, guis, null);
        } catch (RuntimeException e) {
            synchronized (lock) {
                state = State.IDLE;
                seats = List.of();
            }
            for (Seat s : newSeats) {
                if (s.session != null) {
                    s.session.dispose();
                }
            }
            throw e;
        }

        JsonObject o = new JsonObject();
        o.addProperty("matchId", id);
        JsonArray seatsOut = new JsonArray();
        for (Seat s : newSeats) {
            JsonObject j = new JsonObject();
            j.addProperty("index", s.index);
            j.addProperty("kind", s.human ? "human" : "ai");
            j.addProperty("name", s.name);
            if (s.person != null) {
                j.addProperty("person", s.person);
            }
            if (s.ticket != null) {
                j.addProperty("ticket", s.ticket);
            }
            seatsOut.add(j);
        }
        o.add("seats", seatsOut);
        return o;
    }

    private static Deck deckFor(JsonObject seat, boolean human, boolean commander, Opponents.Opponent curated, Set<String> preconsTaken, int index) {
        if (curated != null) {
            String id = "cmdr:precon:" + curated.precon();
            preconsTaken.add(id);
            return Decks.commanderDeck(id, true);
        }
        JsonObject d = seat.has("deck") && seat.get("deck").isJsonObject() ? seat.getAsJsonObject("deck") : null;
        if (d == null) {
            throw new Refused(400, "Seat " + (index + 1) + " has no deck");
        }
        String list = str(d, "list", null);
        if (list != null) {
            try {
                return TrackerDeck.parse(str(d, "name", "Deck"), list);
            } catch (IllegalArgumentException e) {
                throw new Refused(400, e.getMessage());
            }
        }
        String id = str(d, "id", "");
        try {
            if (!commander) {
                return Decks.constructedDeck(id);
            }
            if (id.equals("cmdr:randomprecon")) {
                id = Decks.randomPrecon(preconsTaken);
            }
            preconsTaken.add(id);
            return Decks.commanderDeck(id, !human);
        } catch (IllegalArgumentException e) {
            throw new Refused(400, e.getMessage());
        }
    }

    private static String unique(String name, Set<String> taken) {
        String n = name;
        for (int k = 2; !taken.add(n.toLowerCase()); k++) {
            n = name + " " + k;
        }
        return n;
    }

    /** Checks a decklist without starting anything: null when Forge can play it, else what's wrong. */
    static String checkDeck(JsonObject body) {
        try {
            TrackerDeck.parse(str(body, "name", "Deck"), str(body, "list", ""));
            return null;
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        }
    }

    /** Ends the match with this id for everyone, at the next moment the game thread is waiting on a player. */
    boolean end(String id) {
        List<WebGuiGame> sessions = new ArrayList<>();
        synchronized (lock) {
            if (state != State.PLAYING || !id.equals(matchId)) {
                return false;
            }
            ending = true;
            for (Seat s : seats) {
                if (s.session != null) {
                    sessions.add(s.session);
                }
            }
        }
        for (WebGuiGame s : sessions) {
            WebEdt.invokeLater(s::endForHost);
        }
        return true;
    }

    JsonObject status() {
        synchronized (lock) {
            JsonObject o = new JsonObject();
            o.addProperty("state", state.name().toLowerCase());
            if (matchId != null) {
                o.addProperty("matchId", matchId);
                o.addProperty("format", format);
                o.addProperty("startedAt", startedAt.toString());
                JsonArray arr = new JsonArray();
                for (Seat s : seats) {
                    JsonObject j = new JsonObject();
                    j.addProperty("index", s.index);
                    j.addProperty("kind", s.human ? "human" : "ai");
                    j.addProperty("name", s.name);
                    if (s.person != null) {
                        j.addProperty("person", s.person);
                    }
                    j.addProperty("deck", s.deckName);
                    if (s.human) {
                        j.addProperty("connected", s.channel != null);
                    }
                    arr.add(j);
                }
                o.add("seats", arr);
            }
            if (result != null) {
                o.add("result", result);
            }
            return o;
        }
    }

    /** The match is over: keep its result for GET /match, send it to resultsUrl and each seat's replay to
     * replayUrl, and free the sessions. */
    private void finished(String id) {
        List<Seat> done;
        String url;
        String replays;
        JsonObject r;
        synchronized (lock) {
            if (!id.equals(matchId)) {
                return;
            }
            done = seats;
            WebGuiGame any = done.stream().filter(s -> s.session != null).map(s -> s.session).findFirst().orElse(null);
            r = any == null ? new JsonObject() : any.outcome().deepCopy();
            r.addProperty("matchId", id);
            r.addProperty("status", abandoning ? "abandoned" : ending ? "ended" : r.has("gameOver") && r.get("gameOver").getAsBoolean() ? "finished" : "abandoned");
            r.remove("gameOver");
            r.addProperty("startedAt", startedAt.toString());
            r.addProperty("endedAt", Instant.now().toString());
            result = r;
            state = State.FINISHED;
            finishedAt = Instant.now();
            url = resultsUrl;
            replays = replayUrl;
        }
        for (Seat s : done) {
            if (s.recorder != null) {
                byte[] file = s.recorder.finish(s.session.snapshot(), r);
                System.out.println("Replay of match " + id + " seat " + s.index + ": " + s.recorder.lines() + " lines, " + file.length + " B");
                results.send(replays + "/" + id + "/" + s.index, file, "application/gzip");
            }
            if (s.session != null) {
                s.session.dispose();
            }
        }
        if (url != null) {
            JsonObject body = r.deepCopy();
            body.add("seats", status().get("seats"));
            results.send(url, body);
        }
    }

    // ---------------------------------------------------------------- saved boards (development)

    private List<Path> stateFiles() {
        Map<String, Path> found = new LinkedHashMap<>();
        // bench boards, then the web UI's own small fixtures (tools/states)
        for (Path dir : List.of(repoRoot.resolve("bench").resolve("states"), repoRoot.resolve("forge-gui-web").resolve("tools").resolve("states"))) {
            if (!Files.isDirectory(dir)) {
                continue;
            }
            try (Stream<Path> s = Files.list(dir)) {
                s.filter(Files::isRegularFile).sorted().forEach(p -> found.putIfAbsent(p.getFileName().toString(), p));
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        Path extra = repoRoot.resolve("bench").resolve("token-pod-turn12.txt");
        if (Files.isRegularFile(extra)) {
            found.putIfAbsent(extra.getFileName().toString(), extra);
        }
        return new ArrayList<>(found.values());
    }

    private Path stateFile(String name) {
        for (Path p : stateFiles()) {
            if (p.getFileName().toString().equals(name)) {
                return p;
            }
        }
        throw new Refused(400, "Unknown state " + name);
    }

    private String readState(String name) {
        try {
            return Files.readString(stateFile(name));
        } catch (java.io.IOException e) {
            throw new Refused(400, "Can't read state " + name);
        }
    }

    private GameState loadState(String name) {
        GameState gs = new GameState();
        try (InputStream in = Files.newInputStream(stateFile(name))) {
            gs.parse(in);
        } catch (Exception e) {
            throw new Refused(400, "Can't read state " + name + ": " + e.getMessage());
        }
        return gs;
    }

    static String str(JsonObject o, String key, String dflt) {
        JsonElement e = o.get(key);
        return e != null && e.isJsonPrimitive() ? e.getAsString() : dflt;
    }
}
