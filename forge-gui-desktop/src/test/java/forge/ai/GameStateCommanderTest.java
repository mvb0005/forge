package forge.ai;

import com.google.common.collect.Lists;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameState;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import org.testng.annotations.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.testng.Assert.assertEquals;

/** A 4-player Commander board saved as a GameState and loaded into a new game (the web replays' "play from here"). */
public class GameStateCommanderTest extends AITest {
    private static final String[] COMMANDERS = {"Atraxa, Praetors' Voice", "Krenko, Mob Boss", "Kenrith, the Returned King", "Edgar Markov"};

    private Game fourPlayers() {
        List<RegisteredPlayer> players = Lists.newArrayList();
        for (int i = 0; i < 4; i++) {
            players.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi("p" + i, null)));
        }
        GameRules rules = new GameRules(GameType.Commander);
        Game game = new Game(players, rules, new Match(rules, players, "Test"));
        game.setAge(GameStage.Play);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1, game.getPlayers().get(0));
        game.getPhaseHandler().onStackResolved();
        return game;
    }

    private static String dump(Game game) {
        GameState gs = new GameState();
        gs.initFromGame(game);
        return gs.toString();
    }

    /** Card ids renumber in a new game: name them by first appearance. */
    private static String normalized(String state) {
        Map<String, Integer> ids = new HashMap<>();
        Matcher m = Pattern.compile("(Id:|=|,)(\\d+)(?=:)|Id:(\\d+)").matcher(state);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            boolean prefixed = m.group(2) != null;
            String id = prefixed ? m.group(2) : m.group(3);
            int n = ids.computeIfAbsent(id, k -> ids.size());
            m.appendReplacement(sb, (prefixed ? m.group(1) : "Id:") + "#" + n);
        }
        m.appendTail(sb);
        return sb.toString();
    }

    @Test
    public void commanderTaxAndDamageSurviveSaveAndLoad() {
        Game game = fourPlayers();
        List<Card> commanders = Lists.newArrayList();
        for (int i = 0; i < 4; i++) {
            Player p = game.getPlayers().get(i);
            Card c = addCardToZone(COMMANDERS[i], p, ZoneType.Command);
            p.addCommander(c);
            commanders.add(c);
            addCardToZone("Forest", p, ZoneType.Battlefield);
            addCardToZone("Island", p, ZoneType.Hand);
            addCardToZone("Plains", p, ZoneType.Library);
            addCardToZone("Swamp", p, ZoneType.Library);
        }
        Player p0 = game.getPlayers().get(0);
        Player p1 = game.getPlayers().get(1);
        p0.incCommanderCast(commanders.get(0));
        p0.incCommanderCast(commanders.get(0));
        p1.addCommanderDamage(commanders.get(0), 7);
        p1.addCommanderDamage(commanders.get(2), 3);
        p1.setLife(30, null);

        String saved = dump(game);
        GameState gs = new GameState();
        gs.parse(List.of(saved.split("\n")));
        Game loaded = fourPlayers();
        gs.applyToGameNow(loaded);

        Player q0 = loaded.getPlayers().get(0);
        Player q1 = loaded.getPlayers().get(1);
        Card atraxa = q0.getCommanders().get(0);
        assertEquals(atraxa.getName(), COMMANDERS[0]);
        assertEquals(q0.getCommanderCast(atraxa), 2);
        assertEquals(q1.getCommanderDamage(atraxa), 7);
        assertEquals(q1.getCommanderDamage(loaded.getPlayers().get(2).getCommanders().get(0)), 3);
        assertEquals(q1.getLife(), 30);
        assertEquals(loaded.getPlayers().get(3).getCardsIn(ZoneType.Library).get(0).getName(), "Plains");
        assertEquals(normalized(dump(loaded)), normalized(saved));
    }
}
