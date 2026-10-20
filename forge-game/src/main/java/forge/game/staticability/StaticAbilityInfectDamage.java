package forge.game.staticability;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;

public class StaticAbilityInfectDamage {

    static public boolean isInfectDamage(Player target) {
        final Game game = target.getGame();
        for (final Card ca : game.getCardsWithStaticAbility(StaticAbilityMode.InfectDamage)) {
            for (final StaticAbility stAb : ca.getStaticAbilities()) {
                if (!stAb.checkConditions(StaticAbilityMode.InfectDamage)) {
                    continue;
                }
                if (applyInfectDamageAbility(stAb, target)) {
                    return true;
                }
            }
        }
        return false;
    }

    static public boolean applyInfectDamageAbility(StaticAbility stAb, Player target) {
        if (!stAb.matchesValidParam("ValidTarget", target)) {
            return false;
        }
        return true;
    }
}
