package forge.game.staticability;

import forge.game.Game;
import forge.game.card.Card;

public class StaticAbilityCombatDamageNegatePower {
    public static boolean combatDamageNegatePower(final Card card)  {
        final Game game = card.getGame();
        for (final Card ca : game.getCardsWithStaticAbility(StaticAbilityMode.CombatDamageNegatePower)) {
            for (final StaticAbility stAb : ca.getStaticAbilities()) {
                if (!stAb.checkConditions(StaticAbilityMode.CombatDamageNegatePower)) {
                    continue;
                }

                if (applyCombatDamageNegatePowerAbility(stAb, card)) {
                    return true;
                }
            }
        }
        return false;
    }

    public static boolean applyCombatDamageNegatePowerAbility(final StaticAbility stAb, final Card card) {
        if (!stAb.matchesValidParam("ValidCard", card)) {
            return false;
        }
        return true;
    }

}
