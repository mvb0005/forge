package forge.web.assist;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.player.Player;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The registry of assist producers for one match. {@link #update} runs them at a decision point
 * (only while the caller owns the game: the game thread, or WebEdt while the game thread waits for
 * the human's input), reusing a producer's last result while the decision is the same.
 */
public final class Assists {
    private final List<AssistProducer> producers;
    private final Map<String, String> keys = new HashMap<>();
    private final Map<String, JsonObject> current = new LinkedHashMap<>();
    private final Map<String, String> currentJson = new HashMap<>();
    private final Map<String, Samples> times = new LinkedHashMap<>();
    private final Map<String, Integer> failures = new HashMap<>();

    public Assists(AssistProducer... producers) {
        this.producers = List.of(producers);
        for (AssistProducer p : producers) {
            times.put(p.kind(), new Samples());
        }
    }

    public static Assists standard() {
        return new Assists(new CombatAssist(), new BlockersAssist());
    }

    /** The `caps` entries for the registered kinds. */
    public List<String> caps() {
        List<String> out = new ArrayList<>();
        producers.forEach(p -> out.add("assist." + p.kind()));
        return out;
    }

    /** Runs every producer for this decision; returns the messages whose payload changed since last time. */
    public synchronized List<JsonObject> update(Game game, Player seat, String decision) {
        List<JsonObject> changed = new ArrayList<>();
        for (AssistProducer p : producers) {
            String kind = p.kind();
            if (decision.equals(keys.get(kind))) {
                continue;
            }
            JsonElement payload;
            long t0 = System.nanoTime();
            try {
                payload = p.compute(game, seat);
            } catch (RuntimeException e) {
                if (failures.merge(kind, 1, Integer::sum) <= 3) {
                    System.err.println("Assist " + kind + " failed: " + e);
                    e.printStackTrace();
                }
                continue;
            }
            times.get(kind).add(System.nanoTime() - t0);
            keys.put(kind, decision);
            JsonObject m = new JsonObject();
            m.addProperty("t", "assist");
            m.addProperty("kind", kind);
            m.add(kind, payload == null ? JsonNull.INSTANCE : payload);
            String s = m.toString();
            if (!s.equals(currentJson.get(kind))) {
                currentJson.put(kind, s);
                current.put(kind, m);
                changed.add(m);
            }
        }
        return changed;
    }

    /** The last message of every kind, to re-send after a full state. */
    public synchronized List<JsonObject> current() {
        return new ArrayList<>(current.values());
    }

    /** Per kind: computes (cache misses), p95 and max. */
    public synchronized String stats() {
        StringBuilder sb = new StringBuilder();
        times.forEach((kind, s) -> sb.append(sb.length() == 0 ? "" : "; ").append(kind).append(' ').append(s.summary()));
        return sb.toString();
    }

    /**
     * What the producers' results depend on. Game.cardsVersion covers traits, zones and counters but
     * not tapping, damage, P/T boosts, life or combat assignments, so those are added for the cards and
     * players combat involves. {@code input} is the human's current input, or null for an ask.
     */
    public static String decisionKey(Game game, Player seat, Object input) {
        StringBuilder sb = new StringBuilder(256);
        sb.append(game.getCardsVersion()).append('|').append(game.getPhaseHandler().getTurn())
                .append('|').append(game.getPhaseHandler().getPhase())
                .append('|').append(input == null ? "-" : input.getClass().getSimpleName())
                .append('|').append(game.getStack().size());
        for (Player p : game.getPlayers()) {
            sb.append('|').append(p.getId()).append(':').append(p.getLife()).append(':').append(p.getPoisonCounters());
        }
        Combat combat = game.getCombat();
        if (combat != null) {
            for (Card a : combat.getAttackers()) {
                sb.append("|a").append(a.getId()).append('>').append(combat.getDefenderByAttacker(a) == null ? -1 : combat.getDefenderByAttacker(a).getId());
                card(sb, a);
                for (Card b : combat.getBlockers(a)) {
                    sb.append(",b").append(b.getId());
                    card(sb, b);
                }
            }
            for (Card c : seat.getCreaturesInPlay()) {
                if (c.isTapped()) {
                    sb.append("|t").append(c.getId());
                }
            }
        }
        return sb.toString();
    }

    private static void card(StringBuilder sb, Card c) {
        sb.append(':').append(c.getNetPower()).append('/').append(c.getNetToughness()).append('/').append(c.getDamage())
                .append(c.isTapped() ? "T" : "");
    }
}
