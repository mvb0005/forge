package forge.game.staticability;

import forge.game.Game;
import forge.game.card.Card;

public class StaticAbilityPlotZone {

    public static boolean plotZone(final Card card) {
        final Game game = card.getGame();
        for (final Card ca : game.getCardsWithStaticAbility(StaticAbilityMode.PlotZone)) {
            for (final StaticAbility stAb : ca.getStaticAbilities()) {
                if (!stAb.checkConditions(StaticAbilityMode.PlotZone)) {
                    continue;
                }

                if (applyPlotZoneAbility(stAb, card)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean applyPlotZoneAbility(final StaticAbility stAb, final Card card) {
        if (!stAb.matchesValidParam("ValidCard", card)) {
            return false;
        }
        return true;
    }
}
