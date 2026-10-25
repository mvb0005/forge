package forge.web.assist;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import forge.ai.ComputerUtilCombat;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.keyword.Keyword;
import forge.game.player.Player;

import java.util.List;

/**
 * The combat prediction behind the UI's combat arena, computed by the engine's own combat
 * evaluator (the one the AI uses) on the real game state. Only what's on the board counts:
 * activated abilities and cards in hand are ignored, so nothing hidden leaks.
 * Before blockers are declared the combat has no blocks, so this reads as "if unblocked".
 */
public final class CombatAssist implements AssistProducer {
    @Override
    public String kind() {
        return "combat";
    }

    @Override
    public JsonElement compute(Game game, Player seat) {
        Combat combat = game == null ? null : game.getCombat();
        if (combat == null || combat.getAttackers().isEmpty()) {
            return null;
        }

        JsonArray attackers = new JsonArray();
        for (Card a : combat.getAttackers()) {
            GameEntity defender = combat.getDefenderByAttacker(a);
            List<Card> blockers = combat.getBlockers(a);
            int damage;
            if (blockers.isEmpty()) {
                damage = ComputerUtilCombat.damageIfUnblocked(a, defender, combat, true);
            } else if (a.hasKeyword(Keyword.TRAMPLE)) {
                damage = Math.max(0, ComputerUtilCombat.getAttack(a) - ComputerUtilCombat.totalShieldDamage(a, blockers));
            } else {
                damage = 0;
            }
            JsonObject o = new JsonObject();
            o.addProperty("id", a.getId());
            o.addProperty("dies", !blockers.isEmpty() && ComputerUtilCombat.attackerWouldBeDestroyed(a.getController(), a, combat));
            o.addProperty("damage", damage);
            attackers.add(o);
        }

        JsonArray blockers = new JsonArray();
        for (Card b : combat.getAllBlockers()) {
            JsonObject o = new JsonObject();
            o.addProperty("id", b.getId());
            o.addProperty("dies", ComputerUtilCombat.blockerWouldBeDestroyed(b.getController(), b, combat));
            blockers.add(o);
        }

        JsonArray players = new JsonArray();
        for (Player p : game.getPlayers()) {
            if (combat.getAttackersOf(p).isEmpty()) {
                continue;
            }
            int life = ComputerUtilCombat.lifeThatWouldRemain(p, combat);
            int poison = ComputerUtilCombat.resultingPoison(p, combat);
            JsonObject o = new JsonObject();
            o.addProperty("id", p.getId());
            o.addProperty("lifeAfter", life);
            o.addProperty("poisonAfter", poison);
            o.addProperty("lethal", (life <= 0 && p.canLoseLife()) || poison >= game.getRules().getPoisonCountersToLose());
            players.add(o);
        }

        JsonObject c = new JsonObject();
        c.add("attackers", attackers);
        c.add("blockers", blockers);
        c.add("players", players);
        return c;
    }
}
