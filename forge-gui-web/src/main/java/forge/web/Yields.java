package forge.web;

import java.util.Map;

import forge.game.Game;
import forge.game.GameObject;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.spellability.TargetChoices;
import forge.gamemodes.match.YieldController;
import forge.gamemodes.match.YieldMarker;
import forge.gamemodes.match.YieldUpdate;
import forge.localinstance.properties.ForgePreferences.FPref;

/**
 * A seat's "pass until …" (docs/AUTOPASS.md), on upstream's YieldController: it holds the yield and ends it on the
 * interrupts. This turns the web's kinds into yield updates, names a running yield, and says why one ended early.
 */
final class Yields {
    /** A seat's own interrupt settings: YieldController's overrides win over the shared FModel preferences. */
    static final Map<FPref, String> SEAT_DEFAULTS = Map.of(
            FPref.YIELD_INTERRUPT_ON_ATTACKERS, "true",
            FPref.YIELD_INTERRUPT_ON_TARGETING, "true",
            FPref.YIELD_INTERRUPT_ON_MASS_REMOVAL, "true",
            FPref.YIELD_INTERRUPT_ON_OPPONENT_SPELL, "false", // in a pod, "until my next turn" would end at once
            FPref.YIELD_INTERRUPT_ON_TRIGGERS, "false",
            FPref.YIELD_INTERRUPT_ON_REVEAL, "false",
            FPref.YIELD_AUTO_PASS_RESPECTS_INTERRUPTS, "false");

    private Yields() {}

    static void seatDefaults(YieldController yc) {
        SEAT_DEFAULTS.forEach(yc::setPref);
    }

    /** A running yield as the web names it; what it was set for, to tell reaching it from being interrupted. */
    record Running(String kind, PlayerView owner, PhaseType phase, int turn, String label) {}

    /** The update that starts a yield of this kind, or null when it can't be set now. */
    static YieldUpdate start(String kind, Game game, Player seat, Player who) {
        PlayerView me = seat.getView();
        return switch (kind) {
            case "turn" -> new YieldUpdate.SetAutoPassUntilEndOfTurn(me, true);
            case "nextTurn" -> marker(game, me, PhaseType.UPKEEP);
            case "endStep" -> who == null || who == seat || !game.getPlayers().contains(who) ? null
                    : marker(game, who.getView(), PhaseType.END_OF_TURN);
            case "stack" -> game.getStack().isEmpty() ? null : new YieldUpdate.StackYield(me, true, true);
            default -> null;
        };
    }

    private static YieldUpdate marker(Game game, PlayerView owner, PhaseType phase) {
        return new YieldUpdate.SetMarker(owner, phase, YieldController.isPriorityAtOrPastMarker(game.getView(), owner, phase));
    }

    /** The seat's yield, or null when it isn't yielding. */
    static Running running(YieldController yc, Game game, Player seat) {
        int turn = game.getPhaseHandler().getTurn();
        YieldMarker m = yc.getAutoPassUntilMarker();
        if (m != null) {
            if (m.getPhaseOwner().equals(seat.getView()) && m.getPhase() == PhaseType.UPKEEP) {
                return new Running("nextTurn", m.getPhaseOwner(), m.getPhase(), turn, "Passing until your next turn");
            }
            String step = m.getPhase() == PhaseType.END_OF_TURN ? "end step" : m.getPhase().nameForUi;
            return new Running("endStep", m.getPhaseOwner(), m.getPhase(), turn, "Passing until " + m.getPhaseOwner().getName() + "'s " + step);
        }
        if (yc.autoPassUntilStackEmpty()) {
            return new Running("stack", null, null, turn, "Passing until the stack resolves");
        }
        if (yc.autoPassUntilEndOfTurn()) {
            return new Running("turn", null, null, turn, "Passing until end of turn");
        }
        return null;
    }

    /** Whether a yield that just ended got where it was going (else something interrupted it). */
    static boolean reached(Running y, Game game) {
        PhaseType now = game.getPhaseHandler().getPhase();
        return switch (y.kind()) {
            case "turn" -> now == PhaseType.CLEANUP || game.getPhaseHandler().getTurn() != y.turn();
            case "stack" -> game.getStack().isEmpty();
            default -> {
                Player turn = game.getPhaseHandler().getPlayerTurn();
                yield turn != null && turn.getView().equals(y.owner()) && now != null
                        && (now == y.phase() || now.isAfter(y.phase()));
            }
        };
    }

    /** Why a yield was interrupted, from the game as it is now: the new stack item or the attack. */
    static String why(Game game, Player seat) {
        SpellAbilityStackInstance top = game.getStack().peek();
        if (top != null) {
            Card src = top.getSourceCard();
            String card = src == null ? "something" : src.getName();
            Player who = top.getActivatingPlayer();
            String name = who == null ? "Someone" : who == seat ? "You" : who.getName();
            String did = top.isTrigger() ? card + " triggered" : name + (top.isSpell() ? " cast " : " activated ") + card;
            String target = targeting(top.getSpellAbility(), seat);
            return target == null ? did : did + " targeting " + target;
        }
        Combat combat = game.getCombat();
        if (combat != null && Stops.inCombat(game, seat)) {
            Player attacker = combat.getAttackingPlayer();
            return (attacker == null ? "Someone" : attacker.getName()) + " attacks you";
        }
        return "";
    }

    /** "you" or "your X" when the ability (or one of its sub-abilities) targets the seat or something it controls. */
    private static String targeting(SpellAbility sa, Player seat) {
        for (SpellAbility s = sa; s != null; s = s.getSubAbility()) {
            TargetChoices tc = s.getTargets();
            if (tc == null) {
                continue;
            }
            for (GameObject e : tc) {
                if (e == seat) {
                    return "you";
                }
                if (e instanceof Card c && c.getController() == seat) {
                    return "your " + c.getName();
                }
            }
        }
        return null;
    }
}
