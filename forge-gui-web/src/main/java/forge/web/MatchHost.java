package forge.web;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import forge.card.ColorSet;
import forge.card.MagicColor;
import forge.deck.Deck;
import forge.deck.DeckgenUtil;
import forge.game.GameRules;
import forge.game.GameState;
import forge.game.GameType;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.gui.interfaces.IGuiGame;
import forge.item.PaperCard;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.web.assist.Assists;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/** Owns the browser connection and the lobby; starts matches and hands game messages to the session. */
public final class MatchHost {
    private static final String[] PAIRS = {"WU", "UB", "BR", "RG", "GW", "WB", "UR", "BG", "RW", "GU"};

    private final Path repoRoot;
    private volatile ClientChannel channel;
    private volatile WebGuiGame session;

    public MatchHost(Path repoRoot) {
        this.repoRoot = repoRoot;
    }

    void onConnect(ClientChannel ch) {
        channel = ch;
        WebGuiGame s = session;
        JsonObject hello = new JsonObject();
        hello.addProperty("t", "hello");
        hello.addProperty("version", 2);
        JsonArray caps = new JsonArray();
        caps.add("log.append");
        caps.add("selectables.players");
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
    }

    void onDisconnect(ClientChannel ch) {
        if (channel == ch) {
            channel = null;
            WebGuiGame s = session;
            if (s != null) {
                s.onDisconnect(ch);
            }
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
        JsonArray states = new JsonArray();
        for (Path p : stateFiles()) {
            states.add(p.getFileName().toString());
        }
        o.add("states", states);
        return o;
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
        throw new IllegalArgumentException("Unknown deck " + id);
    }

    private static String str(JsonObject o, String key, String dflt) {
        JsonElement e = o.get(key);
        return e != null && e.isJsonPrimitive() ? e.getAsString() : dflt;
    }

    private void startMatch(JsonObject msg) {
        String deck = str(msg, "deck", "random:RG");
        String oppDeck = str(msg, "opponentDeck", "random:UB");
        int opponents = 1;
        try {
            opponents = Math.max(1, Math.min(3, msg.get("opponents").getAsInt()));
        } catch (Exception ignored) {
        }

        List<RegisteredPlayer> players = new ArrayList<>();
        RegisteredPlayer human = new RegisteredPlayer(deckFor(deck));
        human.setPlayer(GamePlayerUtil.getGuiPlayer());
        players.add(human);
        for (int i = 1; i <= opponents; i++) {
            RegisteredPlayer ai = new RegisteredPlayer(deckFor(oppDeck));
            ai.setPlayer(GamePlayerUtil.createAiPlayer("AI " + i, i));
            players.add(ai);
        }
        GameRules rules = new GameRules(GameType.Constructed);
        rules.setGamesPerMatch(1);
        launch(rules, null, players, human, null);
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
            rp.setPlayer(p == 0 ? GamePlayerUtil.getGuiPlayer() : GamePlayerUtil.createAiPlayer("AI " + p, p));
            rp.setStartingHand(0);
            if (p == 0) {
                human = rp;
            }
            players.add(rp);
        }
        GameRules rules = new GameRules(type);
        rules.setGamesPerMatch(1);
        launch(rules, commander ? EnumSet.of(type) : null, players, human, state);
    }

    private void launch(GameRules rules, Set<GameType> variants, List<RegisteredPlayer> players, RegisteredPlayer human, GameState state) {
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
            if (session == gui) {
                session = null;
            }
            gui.dispose();
            ClientChannel c = channel;
            if (c != null) {
                c.send(lobby());
            }
        });
        Map<RegisteredPlayer, IGuiGame> guis = Map.of(human, gui.gui());
        try {
            match.startMatch(rules, variants, players, guis, null);
        } catch (RuntimeException e) {
            session = null;
            gui.dispose();
            throw e;
        }
    }
}
