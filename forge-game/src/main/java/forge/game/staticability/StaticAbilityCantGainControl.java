package forge.game.staticability;

import forge.game.card.Card;

public class StaticAbilityCantGainControl {

    public static boolean cantGainControl(final Card card) {
        for (final Card ca : card.getGame().getCardsWithStaticAbility(StaticAbilityMode.CantGainControl)) {
            for (final StaticAbility stAb : ca.getStaticAbilities()) {
                if (!stAb.checkConditions(StaticAbilityMode.CantGainControl)) {
                    continue;
                }
                if (applyCantGainControlAbility(stAb, card)) {
                    return true;
                }
            }
        }
        return false;
    }

    public static boolean applyCantGainControlAbility(final StaticAbility stAb, final Card card) {
        return stAb.matchesValidParam("ValidCard", card);
    }
}
