package forge.game.staticability;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;

public class StaticAbilityGainLifeRadiation {

    static public boolean gainLifeRadiation(Player player) {
        final Game game = player.getGame();
        for (final Card ca : game.getCardsWithStaticAbility(StaticAbilityMode.GainLifeRadiation)) {
            for (final StaticAbility stAb : ca.getStaticAbilities()) {
                if (!stAb.checkConditions(StaticAbilityMode.GainLifeRadiation)) {
                    continue;
                }
                if (applyGainLifeRadiation(stAb, player)) {
                    return true;
                }
            }
        }
        return false;
    }

    static public boolean applyGainLifeRadiation(StaticAbility stAb, Player player) {
        if (!stAb.matchesValidParam("ValidPlayer", player)) {
            return false;
        }
        return true;
    }

}
