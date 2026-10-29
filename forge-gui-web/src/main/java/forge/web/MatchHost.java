package forge.web;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonNull;
import forge.LobbyPlayer;
import forge.card.ColorSet;
import forge.card.MagicColor;
import forge.deck.Deck;
import forge.deck.DeckgenUtil;
import forge.deck.io.DeckSerializer;
import forge.StaticData;
import forge.util.MyRandom;
import forge.game.GameRules;
import forge.game.GameState;
import forge.game.GameType;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.gui.interfaces.IGuiGame;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgeConstants;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.player.LobbyPlayerHuman;
import forge.web.assist.Assists;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Owns the one table: one socket, the lobby, and the running match.
 * When Access is configured the seat is a person (their email). A match stays theirs until it ends.
 */
public final class MatchHost {
    /** Someone else already has this table, or another window has this seat. */
    static final int SEAT_TAKEN = 4000;
    /** This socket was closed because the same seat reconnected. */
    static final int SEAT_REPLACED = 4001;
    /** Cloudflare Access did not name a person. */
    static final int SIGN_IN = 4003;
    private static final String[] PAIRS = {"WU", "UB", "BR", "RG", "GW", "WB", "UR", "BG", "RW", "GU"};
    /** Filenames in res/quest/precons, without the extension. Constructed theme decks, not commander lists. */
    private static final String[] PRECONS = {
            "Angelic Might",
            "Spellweaver",
            "Zombies Unleashed",
            "Goblin Assault",
            "Elvish Predation",
            "Azorius Guild Kit",
            "Dimir Guild Kit",
            "Rakdos Guild Kit",
            "Gruul Guild Kit",
            "Selesnya Guild Kit",
            "Orzhov Guild Kit",
            "Izzet Guild Kit",
            "Golgari Guild Kit",
            "Simic Guild Kit",
            "Boros Guild Kit",
            "Sliver Evolution",
            "Sarkhan, Dragonsoul",
            "Morph Mayhem",
            "Huatli, Dinosaur Knight",
            "Vampire Onslaught",
    };
    private static volatile List<Deck> loadedPrecons;
    /** "Arcane Wizardry [C17] [2017]": name, set, year. */
    private static final Pattern PRECON_FILE = Pattern.compile("^(.*?) \\[([^\\]]+)\\] \\[(\\d{4})\\]$");
    private static volatile List<CommanderPrecon> commanderPrecons;

    /** A commander precon as the lobby lists it; the deck itself is read when a match starts. */
    private record CommanderPrecon(String file, String name, String detail, String colors) {}

    private final Path repoRoot;
    private final AccessIdentity access;
    private final PlayLog playLog;
    private final Object seat = new Object();
    private volatile ClientChannel channel;
    private String seatToken;
    private String ownerEmail;
    private String ownerName;
    private String gameId;
    private volatile WebGuiGame session;

    public MatchHost(Path repoRoot, AccessIdentity access, PlayLog playLog) {
        this.repoRoot = repoRoot;
        this.access = access;
        this.playLog = playLog;
        Thread index = new Thread(MatchHost::commanderPrecons, "commander-precons");
        index.setDaemon(true);
        index.start();
    }

    void onConnect(ClientChannel ch, String requested, String jwt) {
        String email = null;
        if (access != null) {
            try {
                email = access.email(jwt);
            } catch (AuthException e) {
                System.err.println("Play sign-in refused: " + e.getMessage());
                ch.close(SIGN_IN, "Sign in through Cloudflare Access");
                return;
            }
        }
        ClientChannel previous;
        WebGuiGame s;
        String token;
        String who;
        String seated;
        synchronized (seat) {
            boolean held = channel != null;
            if (email != null) {
                boolean mine = email.equalsIgnoreCase(ownerEmail);
                boolean reserved = session != null && ownerEmail != null;
                if ((held || reserved) && !mine) {
                    String name = ownerName == null ? "Someone" : ownerName;
                    ch.close(SEAT_TAKEN, name + " is already at this table");
                    return;
                }
                if (!mine) {
                    ownerEmail = email;
                    ownerName = AccessIdentity.displayName(email);
                    seatToken = UUID.randomUUID().toString();
                }
            } else {
                boolean mine = requested != null && requested.equals(seatToken);
                if (held && !mine) {
                    ch.close(SEAT_TAKEN, "This seat is open in another window");
                    return;
                }
                if (!mine) {
                    seatToken = UUID.randomUUID().toString();
                    ownerEmail = null;
                    ownerName = null;
                }
            }
            previous = channel;
            channel = ch;
            token = seatToken;
            s = session;
            who = ownerName == null ? "You" : ownerName;
            seated = ownerEmail;
        }
        JsonObject hello = new JsonObject();
        hello.addProperty("t", "hello");
        hello.addProperty("version", 2);
        hello.addProperty("seat", token);
        hello.addProperty("who", who);
        if (seated != null) {
            hello.addProperty("email", seated);
        }
        JsonArray caps = new JsonArray();
        caps.add("log.append");
        caps.add("selectables.players");
        caps.add("match.commander");
        for (String c : new String[] {"card.basePT", "card.keywordLabels", "player.colorIdentity", "player.commander", "game.turnOrder"}) {
            caps.add(c);
        }
        Assists.standard().caps().forEach(caps::add);
        hello.add("caps", caps);
        hello.addProperty("inMatch", s != null);
        ch.send(hello);
        if (s != null) {
            s.onConnect(ch);
        } else {
            ch.send(lobby());
        }
        if (previous != null) {
            previous.close(SEAT_REPLACED, "This seat reconnected");
        }
    }

    void onDisconnect(ClientChannel ch) {
        WebGuiGame s = null;
        synchronized (seat) {
            if (channel != ch) {
                return;
            }
            channel = null;
            s = session;
        }
        if (s != null) {
            s.onDisconnect(ch);
        }
    }

    void onMessage(ClientChannel ch, JsonObject msg) {
        if (ch != channel) {
            return;
        }
        String t = msg.has("t") && msg.get("t").isJsonPrimitive() ? msg.get("t").getAsString() : "";
        switch (t) {
            case "startMatch", "startState" -> WebEdt.invokeLater(() -> {
                try {
                    if (session != null) {
                        error("A match is already running");
                    } else if (t.equals("startMatch")) {
                        startMatch(msg);
                    } else {
                        startState(msg);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                    error("Could not start: " + e);
                    ClientChannel c = channel;
                    if (c != null && session == null) {
                        c.send(lobby());
                    }
                }
            });
            default -> {
                WebGuiGame s = session;
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
                            error("Error handling " + t + ": " + e);
                        }
                    });
                }
            }
        }
    }

    private void error(String message) {
        ClientChannel ch = channel;
        if (ch != null) {
            JsonObject o = new JsonObject();
            o.addProperty("t", "error");
            o.addProperty("message", message);
            ch.send(o);
        }
    }

    private Path statesDir() {
        return repoRoot.resolve("bench").resolve("states");
    }

    private List<Path> stateFiles() {
        Map<String, Path> found = new LinkedHashMap<>();
        // bench boards, then the web UI's own small fixtures (tools/states)
        for (Path dir : List.of(statesDir(), repoRoot.resolve("forge-gui-web").resolve("tools").resolve("states"))) {
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

    private JsonObject lobby() {
        JsonObject o = new JsonObject();
        o.addProperty("t", "lobby");
        JsonArray decks = new JsonArray();
        for (String pair : PAIRS) {
            JsonObject d = new JsonObject();
            d.addProperty("id", "random:" + pair);
            d.addProperty("name", "Random " + pair);
            d.addProperty("colors", canonicalColors(pair));
            decks.add(d);
        }
        for (Deck deck : precons()) {
            JsonObject d = new JsonObject();
            d.addProperty("id", "precon:" + deck.getName());
            d.addProperty("name", deck.getName());
            d.addProperty("colors", deckColors(deck));
            decks.add(d);
        }
        try {
            for (Deck deck : FModel.getDecks().getConstructed()) {
                JsonObject d = new JsonObject();
                d.addProperty("id", "deck:" + deck.getName());
                d.addProperty("name", deck.getName());
                d.addProperty("colors", deckColors(deck));
                decks.add(d);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        o.add("decks", decks);
        o.add("commanderDecks", commanderDecks());
        JsonArray states = new JsonArray();
        for (Path p : stateFiles()) {
            states.add(p.getFileName().toString());
        }
        o.add("states", states);
        String email;
        synchronized (seat) {
            email = ownerEmail;
        }
        o.add("games", playLog.recent(email, 12));
        return o;
    }

    private static JsonArray commanderDecks() {
        JsonArray decks = new JsonArray();
        decks.add(lobbyDeck("cmdr:random", "Random commander", "", "Generated around a random legend"));
        decks.add(lobbyDeck("cmdr:randomprecon", "Random precon", "", "A different precon for each player"));
        for (CommanderPrecon p : commanderPrecons()) {
            decks.add(lobbyDeck("cmdr:precon:" + p.file(), p.name(), p.colors(), p.detail()));
        }
        try {
            for (Deck deck : FModel.getDecks().getCommander()) {
                decks.add(lobbyDeck("cmdr:deck:" + deck.getName(), deck.getName(), commanderColors(deck.getCommanders()), "Your deck"));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return decks;
    }

    private static JsonObject lobbyDeck(String id, String name, String colors, String detail) {
        JsonObject d = new JsonObject();
        d.addProperty("id", id);
        d.addProperty("name", name);
        d.addProperty("colors", colors);
        if (detail != null && !detail.isEmpty()) {
            d.addProperty("detail", detail);
        }
        return d;
    }

    private static String commanderColors(List<PaperCard> commanders) {
        int mask = 0;
        for (PaperCard c : commanders) {
            mask |= c.getRules().getColorIdentity().getColor();
        }
        return ViewProjector.colors(ColorSet.fromMask(mask));
    }

    /**
     * The commander precons by file name, with the commanders' colour identity. Only each file's
     * [Commander] lines are read (looked up in the card db); the whole deck is parsed when a match starts.
     */
    private static List<CommanderPrecon> commanderPrecons() {
        List<CommanderPrecon> cached = commanderPrecons;
        if (cached != null) {
            return cached;
        }
        synchronized (CommanderPrecon.class) {
            if (commanderPrecons != null) {
                return commanderPrecons;
            }
            long t0 = System.nanoTime();
            List<CommanderPrecon> list = new ArrayList<>();
            File[] files = new File(ForgeConstants.COMMANDER_PRECON_DIR).listFiles((d, n) -> n.endsWith(".dck"));
            if (files != null) {
                Arrays.sort(files);
                for (File f : files) {
                    String file = f.getName().substring(0, f.getName().length() - 4);
                    Matcher m = PRECON_FILE.matcher(file);
                    String name = m.matches() ? m.group(1) : file;
                    String detail = m.matches() ? m.group(2) + " · " + m.group(3) : "";
                    try {
                        list.add(new CommanderPrecon(file, name, detail, commanderColors(commandersIn(f.toPath()))));
                    } catch (Exception e) {
                        System.err.println("Skipping commander precon " + f + ": " + e);
                    }
                }
            }
            System.err.println("Indexed " + list.size() + " commander precons in " + (System.nanoTime() - t0) / 1_000_000 + " ms");
            commanderPrecons = list;
            return list;
        }
    }

    private static List<PaperCard> commandersIn(Path file) throws java.io.IOException {
        List<PaperCard> out = new ArrayList<>();
        boolean in = false;
        for (String line : Files.readAllLines(file)) {
            String l = line.trim();
            if (l.startsWith("[")) {
                in = l.equalsIgnoreCase("[Commander]");
                continue;
            }
            if (!in || l.isEmpty()) {
                continue;
            }
            String name = l.replaceFirst("^\\d+\\s+", "");
            int bar = name.indexOf('|');
            if (bar >= 0) {
                name = name.substring(0, bar);
            }
            PaperCard c = StaticData.instance().getCommonCards().getCard(name.trim());
            if (c != null) {
                out.add(c);
            }
        }
        return out;
    }

    private static Deck commanderDeckFor(String id, boolean forAi) {
        Deck deck = null;
        if ("cmdr:random".equals(id)) {
            deck = DeckgenUtil.generateCommanderDeck(forAi, GameType.Commander);
        } else if (id != null && id.startsWith("cmdr:precon:")) {
            File f = new File(ForgeConstants.COMMANDER_PRECON_DIR, id.substring("cmdr:precon:".length()) + ".dck");
            if (f.isFile()) {
                deck = DeckSerializer.fromFile(f);
            }
        } else if (id != null && id.startsWith("cmdr:deck:")) {
            deck = FModel.getDecks().getCommander().get(id.substring("cmdr:deck:".length()));
        }
        if (deck == null) {
            throw new IllegalArgumentException("Unknown commander deck " + id);
        }
        if (deck.getCommanders().isEmpty()) {
            throw new IllegalArgumentException(deck.getName() + " has no commander");
        }
        return deck;
    }

    /** Precon ids for n seats, all different (while there are enough). */
    private static List<String> randomPrecons(int n, Set<String> taken) {
        List<String> ids = new ArrayList<>();
        for (CommanderPrecon p : commanderPrecons()) {
            String id = "cmdr:precon:" + p.file();
            if (!taken.contains(id)) {
                ids.add(id);
            }
        }
        if (ids.isEmpty()) {
            throw new IllegalArgumentException("No commander precons found");
        }
        Collections.shuffle(ids, MyRandom.getRandom());
        List<String> out = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            out.add(ids.get(i % ids.size()));
        }
        return out;
    }

    /** "Arcane Wizardry" for a precon's "Arcane Wizardry [C17] [2017]". */
    private static String shortName(Deck deck) {
        String n = deck.getName() == null ? "" : deck.getName();
        Matcher m = PRECON_FILE.matcher(n);
        return m.matches() ? m.group(1) : n;
    }

    private static String canonicalColors(String s) {
        StringBuilder sb = new StringBuilder();
        for (char c : "WUBRG".toCharArray()) {
            if (s.indexOf(c) >= 0) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private static String deckColors(Deck deck) {
        int mask = 0;
        for (Map.Entry<PaperCard, Integer> e : deck.getMain()) {
            mask |= e.getKey().getRules().getColor().getColor();
        }
        return ViewProjector.colors(ColorSet.fromMask(mask));
    }

    private static Deck deckFor(String id) {
        if (id != null && id.startsWith("random:")) {
            List<String> names = new ArrayList<>();
            for (char c : id.substring("random:".length()).toUpperCase().toCharArray()) {
                byte color = MagicColor.fromName(c);
                if (color != 0) {
                    names.add(MagicColor.toLongString(color));
                }
            }
            if (names.isEmpty()) {
                throw new IllegalArgumentException("Bad deck id " + id);
            }
            return DeckgenUtil.buildColorDeck(names, null, true);
        }
        if (id != null && id.startsWith("deck:")) {
            Deck d = FModel.getDecks().getConstructed().get(id.substring("deck:".length()));
            if (d != null) {
                return d;
            }
        }
        if (id != null && id.startsWith("precon:")) {
            String name = id.substring("precon:".length());
            for (Deck d : precons()) {
                if (name.equals(d.getName())) {
                    return d;
                }
            }
        }
        throw new IllegalArgumentException("Unknown deck " + id);
    }

    private static List<Deck> precons() {
        List<Deck> cached = loadedPrecons;
        if (cached != null) {
            return cached;
        }
        synchronized (MatchHost.class) {
            if (loadedPrecons != null) {
                return loadedPrecons;
            }
            List<Deck> loaded = new ArrayList<>();
            for (String name : PRECONS) {
                File file = new File(ForgeConstants.QUEST_PRECON_DIR, name + ".dck");
                try {
                    Deck deck = DeckSerializer.fromFile(file);
                    if (deck == null || deck.getMain() == null || deck.getMain().isEmpty()) {
                        System.err.println("Skipping precon " + file);
                        continue;
                    }
                    loaded.add(deck);
                } catch (Exception e) {
                    System.err.println("Skipping precon " + name);
                    e.printStackTrace();
                }
            }
            loadedPrecons = loaded;
            return loaded;
        }
    }

    private static String str(JsonObject o, String key, String dflt) {
        JsonElement e = o.get(key);
        return e != null && e.isJsonPrimitive() ? e.getAsString() : dflt;
    }

    private void startMatch(JsonObject msg) {
        if ("commander".equals(str(msg, "format", "constructed"))) {
            startCommander(msg);
            return;
        }
        String deck = str(msg, "deck", "random:RG");
        String oppDeck = str(msg, "opponentDeck", "random:UB");
        int opponents = 1;
        try {
            opponents = Math.max(1, Math.min(3, msg.get("opponents").getAsInt()));
        } catch (Exception ignored) {
        }

        Deck mine = deckFor(deck);
        Deck opp = deckFor(oppDeck);
        List<RegisteredPlayer> players = new ArrayList<>();
        RegisteredPlayer human = new RegisteredPlayer(mine);
        human.setPlayer(seatedPlayer());
        players.add(human);
        for (int i = 1; i <= opponents; i++) {
            RegisteredPlayer ai = new RegisteredPlayer(deckFor(oppDeck));
            ai.setPlayer(GamePlayerUtil.createAiPlayer("AI " + i, i));
            players.add(ai);
        }
        GameRules rules = new GameRules(GameType.Constructed);
        rules.setGamesPerMatch(1);
        launch(rules, null, players, human, null, "constructed", deck, nameOf(mine, deck), oppDeck, nameOf(opp, oppDeck), opponents);
    }

    /** Commander the way the desktop lobby starts it (GameLobby): forVariants with the Commander variant applied. */
    private void startCommander(JsonObject msg) {
        String deck = str(msg, "deck", "cmdr:randomprecon");
        String oppDeck = str(msg, "opponentDeck", "cmdr:randomprecon");
        int opponents = 3;
        try {
            opponents = Math.max(1, Math.min(3, msg.get("opponents").getAsInt()));
        } catch (Exception ignored) {
        }
        String myId = deck.equals("cmdr:randomprecon") ? randomPrecons(1, Set.of()).get(0) : deck;
        List<String> oppIds = new ArrayList<>();
        if (oppDeck.equals("cmdr:randomprecon")) {
            oppIds.addAll(randomPrecons(opponents, Set.of(myId)));
        } else {
            for (int i = 0; i < opponents; i++) {
                oppIds.add(oppDeck);
            }
        }
        Set<GameType> variants = EnumSet.of(GameType.Commander);
        int seats = opponents + 1;
        Deck mine = commanderDeckFor(myId, false);
        List<RegisteredPlayer> players = new ArrayList<>();
        RegisteredPlayer human = RegisteredPlayer.forVariants(seats, variants, mine, null, false, null, null);
        human.setPlayer(seatedPlayer());
        players.add(human);
        List<String> oppNames = new ArrayList<>();
        for (int i = 1; i <= opponents; i++) {
            Deck d = commanderDeckFor(oppIds.get(i - 1), true);
            oppNames.add(shortName(d));
            RegisteredPlayer ai = RegisteredPlayer.forVariants(seats, variants, d, null, false, null, null);
            ai.setPlayer(GamePlayerUtil.createAiPlayer("AI " + i, i));
            players.add(ai);
        }
        GameRules rules = new GameRules(GameType.Commander);
        rules.setGamesPerMatch(1);
        launch(rules, variants, players, human, null, "commander", myId, shortName(mine), oppDeck, String.join(", ", oppNames), opponents);
    }

    private void startState(JsonObject msg) throws Exception {
        String name = str(msg, "state", "");
        Path file = null;
        for (Path p : stateFiles()) {
            if (p.getFileName().toString().equals(name)) {
                file = p;
            }
        }
        if (file == null) {
            throw new IllegalArgumentException("Unknown state " + name);
        }
        GameState state = new GameState();
        try (InputStream in = Files.newInputStream(file)) {
            state.parse(in);
        }
        boolean commander = Files.readString(file).contains("IsCommander");
        GameType type = commander ? GameType.Commander : GameType.Constructed;

        // the state sets every zone, so players don't need decks (same as SimulateMatch -state)
        List<RegisteredPlayer> players = new ArrayList<>();
        RegisteredPlayer human = null;
        for (int p = 0; p < state.getPlayerCount(); p++) {
            RegisteredPlayer rp = new RegisteredPlayer(new Deck());
            rp.setPlayer(p == 0 ? seatedPlayer() : GamePlayerUtil.createAiPlayer("AI " + p, p));
            rp.setStartingHand(0);
            if (p == 0) {
                human = rp;
            }
            players.add(rp);
        }
        GameRules rules = new GameRules(type);
        rules.setGamesPerMatch(1);
        String label = "state:" + name;
        launch(rules, commander ? EnumSet.of(type) : null, players, human, state, commander ? "commander" : "constructed", label, name, label, name, Math.max(0, players.size() - 1));
    }

    private LobbyPlayer seatedPlayer() {
        synchronized (seat) {
            return ownerName == null ? GamePlayerUtil.getGuiPlayer() : new LobbyPlayerHuman(ownerName);
        }
    }

    private static String nameOf(Deck deck, String fallback) {
        String n = deck == null ? null : deck.getName();
        return n == null || n.isBlank() ? fallback : n;
    }

    private void launch(GameRules rules, Set<GameType> variants, List<RegisteredPlayer> players, RegisteredPlayer human, GameState state,
            String format, String deckId, String deckName, String oppId, String oppName, int opponents) {
        HostedMatch match = new HostedMatch();
        WebGuiGame gui = new WebGuiGame(match);
        session = gui;
        ClientChannel ch = channel;
        if (ch != null) {
            gui.onConnect(ch);
        }
        if (state != null) {
            match.setStartGameHook(() -> state.applyToGameNow(match.getGame()));
        }
        match.setOnMatchOver(() -> {
            endGame(gui);
            if (session == gui) {
                session = null;
            }
            gui.dispose();
            ClientChannel c = channel;
            if (c != null) {
                c.send(lobby());
            }
        });
        beginGame(format, deckId, deckName, oppId, oppName, opponents);
        Map<RegisteredPlayer, IGuiGame> guis = Map.of(human, gui.gui());
        try {
            match.startMatch(rules, variants, players, guis, null);
        } catch (RuntimeException e) {
            endGame(gui);
            session = null;
            gui.dispose();
            throw e;
        }
    }

    /** The record the tracker can read. Written before the match blocks, closed when it ends. */
    private void beginGame(String format, String deckId, String deckName, String oppId, String oppName, int opponents) {
        String id = UUID.randomUUID().toString();
        String email;
        String name;
        synchronized (seat) {
            email = ownerEmail;
            name = ownerName == null ? "You" : ownerName;
            gameId = id;
        }
        JsonObject g = new JsonObject();
        g.addProperty("id", id);
        if (email != null) {
            g.addProperty("email", email);
        }
        g.addProperty("name", name);
        g.addProperty("startedAt", Instant.now().toString());
        g.add("endedAt", JsonNull.INSTANCE);
        g.addProperty("status", "playing");
        g.addProperty("deck", deckId);
        g.addProperty("deckName", deckName);
        g.addProperty("opponentDeck", oppId);
        g.addProperty("opponentDeckName", oppName);
        g.addProperty("opponents", opponents);
        g.addProperty("format", format);
        g.add("winner", JsonNull.INSTANCE);
        g.add("turn", JsonNull.INSTANCE);
        g.add("summary", JsonNull.INSTANCE);
        g.add("log", new JsonArray());
        try {
            playLog.begin(g);
        } catch (RuntimeException e) {
            e.printStackTrace();
        }
    }

    private void endGame(WebGuiGame gui) {
        String id;
        synchronized (seat) {
            id = gameId;
            gameId = null;
        }
        if (id == null) {
            return;
        }
        try {
            playLog.finish(id, gui.outcome());
        } catch (RuntimeException e) {
            e.printStackTrace();
        }
    }

    /** Games for the person this token names, or local games when Access is not configured. */
    JsonObject gamesApi(String jwt, String id) {
        String email = access == null ? null : access.email(jwt);
        if (id == null || id.isEmpty()) {
            return playLog.list(email);
        }
        return playLog.one(email, id);
    }
}
