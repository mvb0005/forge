package forge.game.staticability;

import forge.game.card.Card;
import forge.game.card.CardState;

public class StaticAbilityColorlessDamageSource {

    public static boolean colorlessDamageSource(final CardState state) {
        final Card card = state.getCard();
        for (final Card ca : card.getGame().getCardsWithStaticAbility(StaticAbilityMode.ColorlessDamageSource)) {
            for (final StaticAbility stAb : ca.getStaticAbilities()) {
                if (!stAb.checkConditions(StaticAbilityMode.ColorlessDamageSource)) {
                    continue;
                }
                if (applyColorlessDamageSource(stAb, card)) {
                    return true;
                }
            }
        }
        return false;
    }

    public static boolean applyColorlessDamageSource(final StaticAbility stAb, final Card card) {
        if (!stAb.matchesValidParam("ValidCard", card)) {
            return false;
        }
        return true;
    }
}
