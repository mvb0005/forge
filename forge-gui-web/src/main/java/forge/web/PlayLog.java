package forge.web;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.localinstance.properties.ForgeConstants;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Games this process has hosted, on disk, so a restart or the tracker can still see them.
 * A live match stays in memory; this record is who played, with what, and how it ended.
 */
final class PlayLog {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private final Path file;
    private final Object lock = new Object();
    private final List<JsonObject> games = new ArrayList<>();

    PlayLog(Path file) {
        this.file = file;
        load();
        abandonInterrupted();
    }

    /** In the Forge profile, so an isolated APPDATA isolates it too. Earlier builds wrote under user.home; keep using that log where it exists. */
    static PlayLog open() {
        Path legacy = Path.of(System.getProperty("user.home", "."), "play", "games.json");
        return new PlayLog(Files.exists(legacy) ? legacy : Path.of(ForgeConstants.USER_DIR, "play", "games.json"));
    }

    void begin(JsonObject game) {
        synchronized (lock) {
            games.add(game);
            save();
        }
    }

    /** Fills in the ending from the snapshot WebGuiGame captured, then writes the file. */
    void finish(String id, JsonObject outcome) {
        synchronized (lock) {
            JsonObject game = find(id);
            if (game == null) {
                return;
            }
            boolean over = outcome != null && outcome.has("gameOver") && outcome.get("gameOver").getAsBoolean();
            game.addProperty("status", over ? "finished" : "abandoned");
            game.addProperty("endedAt", Instant.now().toString());
            if (over) {
                copy(outcome, game, "winner");
                copy(outcome, game, "turn");
                copy(outcome, game, "summary");
                if (outcome.has("log")) {
                    game.add("log", outcome.get("log").deepCopy());
                }
            } else {
                game.addProperty("summary", "The match ended before a winner.");
            }
            save();
        }
    }

    /** Newest first, for this person. A null email is local play, which only sees games with no person. */
    JsonObject list(String email) {
        JsonObject o = new JsonObject();
        if (email != null) {
            o.addProperty("email", email);
        }
        o.add("games", recent(email, 50));
        return o;
    }

    /** The game, including its log, or null when it is missing or belongs to someone else. */
    JsonObject one(String email, String id) {
        synchronized (lock) {
            JsonObject game = find(id);
            if (game == null || !owned(game, email)) {
                return null;
            }
            return game.deepCopy();
        }
    }

    JsonArray recent(String email, int limit) {
        JsonArray out = new JsonArray();
        synchronized (lock) {
            for (int i = games.size() - 1; i >= 0 && out.size() < limit; i--) {
                JsonObject game = games.get(i);
                if (owned(game, email)) {
                    JsonObject summary = game.deepCopy();
                    summary.remove("log");
                    out.add(summary);
                }
            }
        }
        return out;
    }

    private JsonObject find(String id) {
        for (int i = games.size() - 1; i >= 0; i--) {
            JsonObject game = games.get(i);
            if (id.equals(text(game, "id"))) {
                return game;
            }
        }
        return null;
    }

    private void abandonInterrupted() {
        boolean changed = false;
        synchronized (lock) {
            for (JsonObject game : games) {
                if ("playing".equals(text(game, "status"))) {
                    game.addProperty("status", "abandoned");
                    game.addProperty("endedAt", Instant.now().toString());
                    game.addProperty("summary", "The server restarted before this game finished.");
                    changed = true;
                }
            }
            if (changed) {
                save();
            }
        }
    }

    private static boolean owned(JsonObject game, String email) {
        String owner = text(game, "email");
        if (email == null) {
            return owner == null;
        }
        return email.equalsIgnoreCase(owner);
    }

    private static void copy(JsonObject from, JsonObject to, String key) {
        if (from.has(key) && !from.get(key).isJsonNull()) {
            to.add(key, from.get(key).deepCopy());
        }
    }

    private void load() {
        if (!Files.isRegularFile(file)) {
            return;
        }
        try {
            JsonObject root = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            JsonElement list = root.get("games");
            if (list != null && list.isJsonArray()) {
                for (JsonElement e : list.getAsJsonArray()) {
                    if (e.isJsonObject()) {
                        games.add(e.getAsJsonObject());
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("Play log unreadable, starting a new one: " + e.getMessage());
            try {
                Files.move(file, file.resolveSibling("games.json.bad"), StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException ioe) {
                ioe.printStackTrace();
            }
        }
    }

    private void save() {
        JsonObject root = new JsonObject();
        root.addProperty("version", 1);
        JsonArray list = new JsonArray();
        for (JsonObject game : games) {
            list.add(game);
        }
        root.add("games", list);
        try {
            Files.createDirectories(file.getParent());
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.writeString(tmp, GSON.toJson(root));
            try {
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (IOException e) {
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String text(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e != null && e.isJsonPrimitive() ? e.getAsString() : null;
    }
}
