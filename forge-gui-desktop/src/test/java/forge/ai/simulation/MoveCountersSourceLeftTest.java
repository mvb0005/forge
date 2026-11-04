package forge.ai.simulation;

import static org.testng.Assert.assertEquals;

import java.util.Map;

import org.testng.annotations.Test;

import com.google.common.collect.Iterables;

import forge.ai.PlayerControllerAi;

import forge.game.Game;
import forge.game.ability.AbilityKey;
import forge.game.card.Card;
import forge.game.card.CardCollectionView;
import forge.game.card.CardLists;
import forge.game.card.CounterEnumType;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.TriggerType;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.ZoneType;

/**
 * "Move counters from this creature" needs this creature. Forgotten Ancient's upkeep trigger, with Forgotten Ancient
 * exiled in response, used to move the counters it had (read from the trigger's last known copy) onto another
 * creature (match 2d5b5b468baf91dd). The exiled card is a new object without counters (CR 400.7), so nothing moves.
 */
public class MoveCountersSourceLeftTest extends SimulationTest {

    private Game game;
    private Player p;
    private Card ancient;
    private Card bears;

    private void upkeepTriggerOnStack() {
        game = initAndCreateGame();
        p = game.getPlayers().get(1);
        game.getPhaseHandler().devModeSet(PhaseType.UPKEEP, p);
        ancient = addCard("Forgotten Ancient", p);
        ancient.addCounterInternal(CounterEnumType.P1P1, 10, p, false, null, null);
        bears = addCard("Grizzly Bears", p);
        game.getAction().checkStateEffects(true);

        game.getTriggerHandler().runTrigger(TriggerType.Phase, AbilityKey.mapFromPlayer(p), false);
        game.getStack().addAllTriggeredAbilitiesToStack();
        assertEquals(game.getStack().size(), 1, "the upkeep trigger is on the stack");
    }

    /** Resolves the stack with Forgotten Ancient's controller saying yes and moving every counter to the Bears. */
    private void resolve() {
        PlayerControllerAi movesAll = new PlayerControllerAi(game, p, p.getController().getLobbyPlayer()) {
            @Override
            public boolean confirmTrigger(WrappedAbility wrapper) {
                return true;
            }

            @Override
            public CardCollectionView chooseCardsForEffect(CardCollectionView options, SpellAbility sa, String title,
                    int min, int max, boolean isOptional, Map<String, Object> params) {
                return CardLists.filter(options, c -> c.equals(bears));
            }

            @Override
            public int chooseNumber(SpellAbility sa, String title, int min, int max, Map<String, Object> params) {
                return max;
            }
        };
        p.runWithController(() -> {
            while (!game.getStack().isEmpty()) {
                game.getStack().resolveStack();
            }
        }, movesAll);
    }

    @Test
    public void exiledInResponseMovesNothing() {
        upkeepTriggerOnStack();
        game.getAction().exile(ancient, null, null);
        resolve();

        Card exiled = Iterables.getOnlyElement(p.getCardsIn(ZoneType.Exile));
        assertEquals(exiled.getName(), "Forgotten Ancient");
        assertEquals(exiled.getCounters(CounterEnumType.P1P1), 0);
        assertEquals(game.getCardState(bears).getCounters(CounterEnumType.P1P1), 0, "no counters came from exile");
    }

    @Test
    public void stillOnBattlefieldMovesCounters() {
        upkeepTriggerOnStack();
        resolve();

        int left = game.getCardState(ancient).getCounters(CounterEnumType.P1P1);
        int moved = game.getCardState(bears).getCounters(CounterEnumType.P1P1);
        assertEquals(moved, 10, "every counter moves onto the Grizzly Bears");
        assertEquals(left, 0, "counters move, they aren't copied");
    }
}
