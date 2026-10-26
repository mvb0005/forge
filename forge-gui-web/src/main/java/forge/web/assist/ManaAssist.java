package forge.web.assist;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import forge.game.Game;
import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.Map;
import java.util.TreeMap;

/**
 * Per player, the mana their untapped permanents could add right now with a free "{T}: Add" mana
 * ability (lands, rocks, dorks that aren't summoning sick). Each source counts once, under the
 * colours it can make: one letter for one colour, several letters ("WG") for "one of these", "any"
 * for all five. Abilities with a mana cost (filters, signets) are left out.
 */
public final class ManaAssist implements AssistProducer {
    private static final String ORDER = "WUBRGC";

    @Override
    public String kind() {
        return "mana";
    }

    /** Tapping doesn't move Game.cardsVersion, so the tapped permanents are part of the key. */
    @Override
    public String key(Game game, Player seat) {
        StringBuilder sb = new StringBuilder(128);
        for (Card c : game.getCardsIn(ZoneType.Battlefield)) {
            if (c.isTapped()) {
                sb.append(c.getId()).append(',');
            }
        }
        return sb.toString();
    }

    @Override
    public JsonElement compute(Game game, Player seat) {
        if (game == null) {
            return null;
        }
        JsonArray players = new JsonArray();
        for (Player p : game.getPlayers()) {
            Map<String, Integer> open = new TreeMap<>();
            int total = 0;
            for (Card c : p.getCardsIn(ZoneType.Battlefield)) {
                if (c.isTapped() || c.getManaAbilities().isEmpty()) {
                    continue;
                }
                String colors = "";
                int amount = 0;
                for (SpellAbility ma : c.getManaAbilities()) {
                    if (!ma.getPayCosts().hasTapCost() || ma.getPayCosts().hasManaCost()) {
                        continue;
                    }
                    ma.setActivatingPlayer(p);
                    if (!ma.canPlay()) {
                        continue;
                    }
                    AbilityManaPart part = ma.getManaPart();
                    int n = amount(c, ma);
                    String made;
                    if (part.isAnyMana() || part.isSpecialMana()) {
                        made = "WUBRG";
                    } else {
                        made = part.mana(ma);
                        if (!part.isComboMana()) {
                            n *= Math.max(1, made.trim().split(" +").length);
                        }
                    }
                    colors = union(colors, made);
                    amount = Math.max(amount, n);
                }
                if (amount <= 0 || colors.isEmpty()) {
                    continue;
                }
                String key = colors.startsWith("WUBRG") ? "any" : colors;
                open.merge(key, amount, Integer::sum);
                total += amount;
            }
            JsonObject o = new JsonObject();
            o.addProperty("id", p.getId());
            o.addProperty("total", total);
            JsonObject m = new JsonObject();
            open.forEach(m::addProperty);
            o.add("open", m);
            players.add(o);
        }
        JsonObject out = new JsonObject();
        out.add("players", players);
        return out;
    }

    private static int amount(Card c, SpellAbility ma) {
        try {
            return AbilityUtils.calculateAmount(c, ma.getParamOrDefault("Amount", "1"), ma);
        } catch (RuntimeException e) {
            return 1;
        }
    }

    /** The letters of a and b, in WUBRGC order. */
    private static String union(String a, String b) {
        StringBuilder sb = new StringBuilder(6);
        for (char ch : ORDER.toCharArray()) {
            if (a.indexOf(ch) >= 0 || b.indexOf(ch) >= 0) {
                sb.append(ch);
            }
        }
        return sb.toString();
    }
}
