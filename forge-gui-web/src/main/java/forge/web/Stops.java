package forge.web;

import java.util.EnumSet;
import java.util.Set;

import forge.game.Game;
import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.spellability.SpellAbilityStackInstance;

/**
 * Where priority asks a seat (docs/AUTOPASS.md). With an empty stack, only in its stops: on its own turn the main
 * phases and the combat steps (it has priority first after attacks and after blocks, 509.4); on someone else's turn
 * the end step, and the combat steps only when that combat involves it. Their beginning of combat (tap or kill a
 * would-be attacker) stops only in 1v1: in a pod you can't tell yet whom they'll attack.
 */
final class Stops {
    private static final Set<PhaseType> MINE = EnumSet.of(PhaseType.MAIN1, PhaseType.COMBAT_DECLARE_ATTACKERS,
            PhaseType.COMBAT_DECLARE_BLOCKERS, PhaseType.COMBAT_FIRST_STRIKE_DAMAGE, PhaseType.MAIN2);

    private Stops() {}

    /** Whether priority with an empty stack asks the seat in this step of turnPlayer's turn. */
    static boolean stopsAt(Game game, Player seat, Player turnPlayer, PhaseType phase) {
        if (phase == null) {
            return false;
        }
        if (turnPlayer == seat) {
            return MINE.contains(phase);
        }
        return switch (phase) {
            case COMBAT_BEGIN -> game.getPlayers().size() <= 2;
            case COMBAT_DECLARE_ATTACKERS, COMBAT_DECLARE_BLOCKERS, COMBAT_FIRST_STRIKE_DAMAGE -> inCombat(game, seat);
            case END_OF_TURN -> true;
            default -> false;
        };
    }

    /** Something attacks the seat, a planeswalker it controls or a battle it protects. */
    static boolean inCombat(Game game, Player seat) {
        Combat combat = game.getCombat();
        if (combat == null) {
            return false;
        }
        try {
            for (GameEntity d : combat.getDefenders()) {
                boolean theirs = d == seat || (d instanceof Card c
                        && (c.isBattle() ? c.getProtectingPlayer() == seat : c.getController() == seat));
                if (theirs && !combat.getAttackersOf(d).isEmpty()) {
                    return true;
                }
            }
        } catch (RuntimeException e) {
            return true; // combat changed under us (read off the game thread): asking is the safe answer
        }
        return false;
    }

    /** The top of the stack is the seat's own spell or activated ability (not a trigger). */
    static boolean ownTop(Game game, Player seat) {
        SpellAbilityStackInstance top = game.getStack().peek();
        return top != null && !top.isTrigger() && top.getActivatingPlayer() == seat;
    }
}
