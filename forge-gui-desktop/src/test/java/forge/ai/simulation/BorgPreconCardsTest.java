package forge.ai.simulation;

import static org.testng.Assert.assertEquals;

import java.util.ArrayList;
import java.util.List;

import org.testng.annotations.Test;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

/** The Star Trek Borg precon's cards taken from open upstream PRs load: each goes to hand and battlefield. */
public class BorgPreconCardsTest extends SimulationTest {

    static final String[] CARDS = {
        "Ambulatory Reactor", "Assimilate the Wounded", "Assimilation Assessor", "Battle of Wolf 359", "Borg Incursion",
        "Borg Scout Sphere", "Class-4 Tactical Cube", "Co-Option Adjutant", "Collective Override", "Command Subadjunct",
        "Conquest Mission", "Deliver from Chaos", "Emergency Regeneration", "Extraction Integrant", "Gift of Perfection",
        "Hugh, First of Many", "Jurati, Cordial Queen", "Korok, Liberated Rage", "Locutus of Borg", "Maturation Chamber",
        "One, Borg Evolved", "Optimization Annex", "Queen's Diamond", "Reclamation Specialist", "Reconnaissance Partition",
        "Seven of Nine, Tertiary Adjunct", "Shore Leave Planet", "Stratagem Emulator", "Supplementation Node",
        "The Best of Both Worlds", "Transwarp Hub", "Type-03 Borg Vessel", "Võx, Child of the Collective",
    };

    @Test
    public void everyCardLoads() {
        Game game = initAndCreateGame();
        Player p = game.getPlayers().get(1);
        List<String> broken = new ArrayList<>();
        for (String name : CARDS) {
            try {
                Card inHand = addCardToZone(name, p, ZoneType.Hand);
                for (SpellAbility sa : inHand.getAllSpellAbilities()) {
                    sa.getDescription();
                }
                if (!inHand.isLand() && inHand.getFirstSpellAbility() == null) {
                    broken.add(name + ": no spell");
                }
                addCard(name, p);
                game.getAction().checkStateEffects(true);
            } catch (Throwable t) {
                broken.add(name + ": " + t);
            }
        }
        assertEquals(broken, List.of());
    }
}
