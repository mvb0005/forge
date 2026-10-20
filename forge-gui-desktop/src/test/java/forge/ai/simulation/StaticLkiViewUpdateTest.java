package forge.ai.simulation;

import java.util.ArrayList;
import java.util.List;

import org.testng.AssertJUnit;
import org.testng.annotations.Test;

import forge.ai.ComputerUtilAbility;
import forge.game.Game;
import forge.game.GameActionUtil;
import forge.game.card.Card;
import forge.game.card.CardView.CardStateView;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.spellability.AlternativeCost;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

public class StaticLkiViewUpdateTest extends SimulationTest {

    private static List<String> snapshotViews(Game game) {
        List<String> views = new ArrayList<>();
        for (Card c : game.getCardsIn(ZoneType.Battlefield)) {
            CardStateView v = c.getView().getCurrentState();
            views.add(c.getId() + "|" + v.getName() + "|" + v.getType() + "|" + v.getPower() + "/" + v.getToughness()
                    + "|" + v.getKeywords() + "|" + v.getAbilityText());
        }
        return views;
    }

    @Test
    public void testAbilityGatheringWithStackStaticsKeepsViewsAndAlternatives() {
        Game game = initAndCreateGame();
        Player ai = game.getPlayers().get(1);
        Player opp = game.getPlayers().get(0);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1, ai);

        // statics affecting spells on the Stack in the ABILITIES layer
        addCard("Chief Engineer", ai);
        addCard("Ezio Auditore da Firenze", ai);
        // ABILITIES-layer anthem so creatures' keywords/ability text are touched each pass
        addCard("Fervor", ai);
        addCard("Fervor", opp);
        // ETB charm triggers: ability text generation counts targets across the board
        addCards("Aether Channeler", 25, ai);
        addCards("Aether Channeler", 25, opp);
        addCards("Swamp", 10, ai);
        for (int i = 0; i < 15; i++) {
            addCardToZone("Cryptic Command", ai, ZoneType.Hand);
            addCardToZone("Ornithopter", ai, ZoneType.Hand);
        }
        Card assassin = addCardToZone("Abyssal Hunter", ai, ZoneType.Hand);
        game.getAction().checkStateEffects(true);

        List<String> viewsBefore = snapshotViews(game);
        List<SpellAbility> sas = ComputerUtilAbility.getSpellAbilities(ComputerUtilAbility.getAvailableCards(game, ai), ai);
        AssertJUnit.assertFalse(sas.isEmpty());
        AssertJUnit.assertEquals(viewsBefore, snapshotViews(game));

        // Freerunning only exists on the hypothetical stack copy
        AssertJUnit.assertTrue(GameActionUtil.getAlternativeCosts(assassin.getFirstSpellAbility(), ai, false).stream()
                .anyMatch(sa -> sa.isAlternativeCost(AlternativeCost.Freerunning)));
        AssertJUnit.assertEquals(viewsBefore, snapshotViews(game));
    }
}
