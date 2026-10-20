package forge.ai.attacking;

import java.util.ArrayList;
import java.util.List;

import org.testng.AssertJUnit;
import org.testng.annotations.Test;

import forge.ai.AiAttackController;
import forge.ai.AiBlockController;
import forge.ai.ComputerUtil;
import forge.ai.PlayerControllerAi;
import forge.ai.simulation.SimulationTest;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.ability.AbilityKey;
import forge.game.ability.SpellAbilityEffect;
import forge.game.card.Card;
import forge.game.card.CardLists;
import forge.game.card.CounterEnumType;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.zone.ZoneType;

// AI combat decisions on boards full of Scute Swarm copies, with a few copies that must not be grouped with the rest.
// The expected hash was recorded before ComputerUtilCard.getCombatClasses existed; grouping must not change any decision.
public class ScuteCombatClassesTest extends SimulationTest {

    private static final int EXPECTED_DECISIONS_HASH = -448753775;

    private static String describe(Combat combat) {
        List<String> out = new ArrayList<>();
        for (Card a : combat.getAttackers()) {
            List<Integer> bl = new ArrayList<>();
            for (Card b : combat.getBlockers(a)) {
                bl.add(b.getId());
            }
            out.add(a.getId() + "->" + combat.getDefenderByAttacker(a) + bl);
        }
        return String.join(",", out);
    }

    // real landfall copies: each land drop doubles the swarm
    private List<Card> growScutes(Game game, Player p, int drops) {
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1, p);
        addCard("Scute Swarm", p);
        addCards("Forest", 6, p);
        for (int i = 0; i < drops; i++) {
            game.getAction().checkStateEffects(true);
            Card land = addCardToZone("Forest", p, ZoneType.Hand);
            game.getAction().moveToPlay(land, null, AbilityKey.newMap());
            game.getTriggerHandler().runWaitingTriggers();
            game.getStack().addAllTriggeredAbilitiesToStack();
            while (!game.getStack().isEmpty()) {
                game.getStack().resolveStack();
            }
        }
        List<Card> scutes = CardLists.filter(p.getCreaturesInPlay(), c -> c.getName().equals("Scute Swarm"));
        AssertJUnit.assertEquals(1 << drops, scutes.size());
        for (Card c : scutes) {
            c.setSickness(false);
        }
        return scutes;
    }

    private Game setupBoard(int drops, boolean control) {
        return setupBoard(drops, drops - 1, control);
    }

    private Game setupBoard(int drops, int oppDrops, boolean control) {
        Game game = initAndCreateGame();
        Player ai = game.getPlayers().get(1);
        Player opp = game.getPlayers().get(0);
        if (control) {
            ((PlayerControllerAi) ai.getController()).setupAutoProfile(new Deck("Control"));
        }
        List<Card> mine = growScutes(game, ai, drops);
        List<Card> theirs = growScutes(game, opp, oppDrops);

        // copies that must not be treated like the rest
        addCard("Grizzly Bears", ai).setSickness(false);
        addCard("Hill Giant", opp).setSickness(false);
        mine.get(1).setTapped(true);
        mine.get(2).setSickness(true);
        addCard("Pacifism", opp).attachToEntity(mine.get(3), null);
        mine.get(4).addHiddenExtrinsicKeywords(game.getNextTimestamp(), 0, List.of("CARDNAME can't block."));
        theirs.get(1).addCounterInternal(CounterEnumType.P1P1, 1, opp, false, null, null);
        Card unblockable = theirs.get(2);
        Card eff = SpellAbilityEffect.createEffect(null, unblockable, opp, "Unblockable Effect", null, game.getNextTimestamp());
        eff.addStaticAbility("Mode$ CantBlockBy | ValidAttacker$ Card.IsRemembered | EffectZone$ Command | Description$ Can't be blocked.");
        eff.addRemembered(unblockable);
        opp.getZone(ZoneType.Command).add(eff);
        game.getAction().checkStateEffects(true);
        AssertJUnit.assertFalse(CombatUtil.canBlock(unblockable, mine.get(0)));
        AssertJUnit.assertTrue(CombatUtil.canBlock(theirs.get(3), mine.get(0)));
        return game;
    }

    private String runAttack(int drops, boolean control, int oppLife) {
        Game game = setupBoard(drops, control);
        Player ai = game.getPlayers().get(1);
        game.getPlayers().get(0).setLife(oppLife, null);
        game.getPhaseHandler().devModeSet(PhaseType.COMBAT_DECLARE_ATTACKERS, ai);
        Combat combat = new Combat(ai);
        new AiAttackController(ai).declareAttackers(combat);
        return describe(combat);
    }

    private String runBlock(int drops, boolean control) {
        Game game = setupBoard(drops, control);
        Player ai = game.getPlayers().get(1);
        Player opp = game.getPlayers().get(0);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1, ai);
        int life = ComputerUtil.predictNextCombatsRemainingLife(ai, false, true, 0, null);

        game.getPhaseHandler().devModeSet(PhaseType.COMBAT_DECLARE_ATTACKERS, opp);
        Combat combat = new Combat(opp);
        for (Card att : opp.getCreaturesInPlay()) {
            if (CombatUtil.canAttack(att, ai)) {
                combat.addAttacker(att, ai);
            }
        }
        new AiBlockController(ai, false).assignBlockersForCombat(combat);
        return "life=" + life + " " + describe(combat);
    }

    @Test
    public void groupingKeepsDecisions() {
        // card ids are global, so this extra game keeps them the same as when the hash was recorded
        runBlock(3, false);
        StringBuilder all = new StringBuilder();
        for (int drops : new int[] {4, 5, 6}) {
            for (boolean control : new boolean[] {false, true}) {
                if (drops == 6 && control) {
                    continue;
                }
                all.append(runBlock(drops, control)).append('\n');
                all.append(runAttack(drops, control, 20)).append('\n');
                all.append(runAttack(drops, control, 8)).append('\n');
            }
        }
        AssertJUnit.assertEquals(all.toString(), EXPECTED_DECISIONS_HASH, all.toString().hashCode());
    }
}
