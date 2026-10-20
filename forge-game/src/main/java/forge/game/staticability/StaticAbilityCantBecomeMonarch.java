package forge.game.staticability;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;

public class StaticAbilityCantBecomeMonarch {

    public static boolean anyCantBecomeMonarch(final Player player) {
        final Game game = player.getGame();
        for (final Card ca : game.getCardsWithStaticAbility(StaticAbilityMode.CantBecomeMonarch)) {
            for (final StaticAbility stAb : ca.getStaticAbilities()) {
                if (!stAb.checkConditions(StaticAbilityMode.CantBecomeMonarch)) {
                    continue;
                }
                if (applyCantBecomeMonarchAbility(stAb, player)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean applyCantBecomeMonarchAbility(final StaticAbility stAb, final Player player) {
        if (!stAb.matchesValidParam("ValidPlayer", player)) {
            return false;
        }
        return true;
    }
}
