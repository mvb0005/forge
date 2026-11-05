package forge.ai;

import forge.ImageKeys;
import forge.StaticData;
import forge.game.Game;
import forge.game.GameState;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import org.testng.annotations.Test;

import java.util.List;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertTrue;

/** Face-down cards on a saved board (GameState), as the web replays' "play from here" loads one. */
public class GameStateFaceDownTest extends AITest {
    @Test
    public void manifestedAndCloakedCardsFromASavedBoardShowTheirBacks() {
        Game game = initAndCreateGame();
        Player p = game.getPlayers().get(0);
        String board = "humanlife=20\nailife=20\nturn=1\nactiveplayer=human\nactivephase=MAIN1\n"
                + "humanbattlefield=Grizzly Bears|FaceDown:Manifested;Hill Giant|FaceDown:Cloaked\n";
        GameState gs = new GameState();
        gs.parse(List.of(board.split("\n")));
        gs.applyToGameNow(game);

        List<Card> cards = p.getCardsIn(ZoneType.Battlefield).stream().toList();
        assertEquals(cards.size(), 2);
        Card manifested = cards.stream().filter(Card::isManifested).findFirst().orElseThrow();
        Card cloaked = cards.stream().filter(Card::isCloaked).findFirst().orElseThrow();
        assertTrue(manifested.isFaceDown());
        assertEquals(manifested.getFacedownImageKey(), StaticData.instance().getOtherImageKey(ImageKeys.MANIFEST_IMAGE, null));
        assertEquals(cloaked.getFacedownImageKey(), StaticData.instance().getOtherImageKey(ImageKeys.CLOAKED_IMAGE, null));
    }
}
