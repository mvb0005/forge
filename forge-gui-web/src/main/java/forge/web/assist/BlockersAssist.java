package forge.web.assist;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import forge.card.MagicColor;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.keyword.Keyword;
import forge.game.player.Player;
import forge.game.staticability.StaticAbilityCantAttackBlock;
import forge.gamemodes.match.input.InputBlock;
import forge.player.PlayerControllerHuman;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * While the seat declares blockers: for each attacker coming at it, which of its creatures may block
 * that attacker right now and why the others can't. Legality is CombatUtil.canBlock; the reasons
 * only name which of the engine's checks failed.
 */
public final class BlockersAssist implements AssistProducer {
    @Override
    public String kind() {
        return "blockers";
    }

    @Override
    public JsonElement compute(Game game, Player seat) {
        Combat combat = game == null ? null : game.getCombat();
        if (combat == null || !(seat.getController() instanceof PlayerControllerHuman h)
                || !(h.getInputQueue().getInput() instanceof InputBlock)) {
            return null;
        }
        CardCollection creatures = seat.getCreaturesInPlay();
        // why a creature can't block anything at all, or null when it's free to block
        Map<Card, String> busy = new LinkedHashMap<>();
        for (Card b : creatures) {
            busy.put(b, CombatUtil.canBlock(b, combat) ? null : blockerReason(b, combat));
        }

        JsonArray attackers = new JsonArray();
        for (Card a : combat.getAttackers()) {
            if (combat.getDefendingPlayerRelatedTo(a) != seat) {
                continue;
            }
            int minBlockers = Math.max(1, CombatUtil.getMinNumBlockersForAttacker(a, seat));
            String unblockable = null;
            if (StaticAbilityCantAttackBlock.cantBlockBy(a, null)) {
                unblockable = "Can't be blocked";
            } else if (!CombatUtil.canBeBlocked(a, combat, seat)) {
                unblockable = "Can't be blocked by more creatures";
            }
            List<Card> legal = new ArrayList<>();
            List<Card> fresh = new ArrayList<>();
            JsonArray cannot = new JsonArray();
            for (Card b : creatures) {
                String why;
                if (combat.isBlocking(b, a)) {
                    legal.add(b);
                    continue;
                } else if (busy.get(b) != null) {
                    why = busy.get(b);
                } else if (unblockable != null) {
                    why = unblockable;
                } else if (CombatUtil.canBlock(a, b, combat)) {
                    legal.add(b);
                    fresh.add(b);
                    continue;
                } else if (StaticAbilityCantAttackBlock.cantBlockBy(a, b)) {
                    why = evasion(a, b);
                } else {
                    why = "Must block another attacker";
                }
                if (!b.isTapped()) {
                    cannot.add(entry(b, why));
                }
            }
            if (legal.size() < minBlockers) {
                String why = minBlockers == 2 && a.hasKeyword(Keyword.MENACE) ? "Menace: needs a second blocker" : "Needs " + minBlockers + " blockers";
                for (Card b : fresh) {
                    legal.remove(b);
                    cannot.add(entry(b, why));
                }
            }
            JsonArray can = new JsonArray();
            legal.forEach(b -> can.add(b.getId()));
            JsonObject o = new JsonObject();
            o.addProperty("attackerId", a.getId());
            o.add("canBlock", can);
            o.add("cannotBlock", cannot);
            o.addProperty("minBlockers", minBlockers);
            attackers.add(o);
        }
        JsonObject out = new JsonObject();
        out.add("attackers", attackers);
        return out;
    }

    private static JsonObject entry(Card b, String reason) {
        JsonObject o = new JsonObject();
        o.addProperty("id", b.getId());
        o.addProperty("reason", reason);
        return o;
    }

    /** Which part of CombatUtil.canBlock(blocker, combat) failed. */
    private static String blockerReason(Card b, Combat combat) {
        if (b.isPhasedOut()) {
            return "Phased out";
        }
        if (b.isTapped() && !StaticAbilityCantAttackBlock.canBlockTapped(b)) {
            return "Tapped";
        }
        if (b.hasKeyword("CARDNAME can't block.") || b.hasKeyword("CARDNAME can't attack or block.")
                || StaticAbilityCantAttackBlock.cantBlock(b)) {
            return "Can't block";
        }
        if (!CombatUtil.canBlock(b)) {
            return "Can't block alone";
        }
        if (!CombatUtil.canBlockMoreCreatures(b, combat.getAttackersBlockedBy(b))) {
            return "Already blocking";
        }
        return "Block limit reached";
    }

    /** The attacker's evasion that cantBlockBy(attacker, blocker) most likely tripped on. */
    private static String evasion(Card a, Card b) {
        if (a.hasKeyword(Keyword.FLYING) && !b.hasKeyword(Keyword.FLYING) && !b.hasKeyword(Keyword.REACH)) {
            return "Flying: needs flying or reach";
        }
        if (a.hasKeyword(Keyword.SHADOW) != b.hasKeyword(Keyword.SHADOW)) {
            return a.hasKeyword(Keyword.SHADOW) ? "Shadow: needs shadow" : "Shadow: can only block shadow";
        }
        if (a.hasKeyword(Keyword.HORSEMANSHIP) && !b.hasKeyword(Keyword.HORSEMANSHIP)) {
            return "Horsemanship: needs horsemanship";
        }
        if (a.hasKeyword(Keyword.FEAR) && !b.isArtifact() && !b.getColor().hasAnyColor(MagicColor.BLACK)) {
            return "Fear: needs an artifact or black creature";
        }
        if (a.hasKeyword(Keyword.INTIMIDATE) && !b.isArtifact() && !b.sharesColorWith(a)) {
            return "Intimidate: needs an artifact creature or a shared colour";
        }
        if (a.hasKeyword(Keyword.SKULK) && b.getNetPower() > a.getNetPower()) {
            return "Skulk: power too high";
        }
        return "Can't block this attacker";
    }
}
