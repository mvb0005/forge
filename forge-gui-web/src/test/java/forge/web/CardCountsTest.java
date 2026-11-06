package forge.web;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

import forge.StaticData;
import forge.ai.LobbyPlayerAi;
import forge.card.CardStateName;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

/**
 * The live numbers a card's abilities count (CardCounts). Needs forge-gui/res; point APPDATA/LOCALAPPDATA at a
 * scratch folder. {@code -Dcounts.sweep=true} also runs every card script through it and prints what it finds.
 */
public class CardCountsTest {
    private static boolean initialized;

    @BeforeClass
    public void initModel() {
        if (initialized) {
            return;
        }
        initialized = true;
        String assets = Path.of("..", "forge-gui").toAbsolutePath().normalize() + File.separator;
        GuiBase.setInterface(new WebMain.HeadlessGui(assets));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });
    }

    private static Game game() {
        List<RegisteredPlayer> regs = new ArrayList<>();
        for (String n : new String[] {"Me", "Ann"}) {
            regs.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi(n, null)));
        }
        GameRules rules = new GameRules(GameType.Constructed);
        Game game = new Game(regs, rules, new Match(rules, regs, "Test"));
        game.setAge(GameStage.Play);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1, game.getPlayers().get(0));
        return game;
    }

    private static Card add(String name, Player p, ZoneType zone) {
        IPaperCard paper = FModel.getMagicDb().getCommonCards().getCard(name);
        if (paper == null) {
            StaticData.instance().attemptToLoadCard(name);
            paper = FModel.getMagicDb().getCommonCards().getCard(name);
        }
        Card c = Card.fromPaperCard(paper, p);
        c.setGameTimestamp(p.getGame().getNextTimestamp());
        p.getZone(zone).add(c);
        return c;
    }

    @Test
    public void costReductionInHandCountsTheBoard() {
        Game game = game();
        Player me = game.getPlayers().get(0);
        Player ann = game.getPlayers().get(1);
        Card act = add("Blasphemous Act", me, ZoneType.Hand);
        add("Grizzly Bears", me, ZoneType.Battlefield);
        add("Grizzly Bears", ann, ZoneType.Battlefield);
        add("Forest", ann, ZoneType.Battlefield);
        List<CardCounts.Count> counts = CardCounts.of(act);
        assertEquals(counts.size(), 1);
        assertEquals(counts.get(0).value(), 2);
        assertEquals(counts.get(0).text(), "Blasphemous Act costs {1} less to cast for each creature on the battlefield.");
    }

    @Test
    public void heliodCountsWhatOpponentsDrew() {
        Game game = game();
        Player me = game.getPlayers().get(0);
        Player ann = game.getPlayers().get(1);
        Card heliod = add("Heliod, the Radiant Dawn", me, ZoneType.Battlefield);
        assertTrue(CardCounts.of(heliod).isEmpty());
        heliod.setState(CardStateName.Backside, true);
        for (int i = 0; i < 3; i++) {
            add("Forest", ann, ZoneType.Library);
        }
        ann.drawCards(3);
        List<CardCounts.Count> counts = CardCounts.of(heliod);
        assertEquals(counts.size(), 1);
        assertEquals(counts.get(0).value(), 3);
        assertTrue(counts.get(0).text().contains("for each card your opponents have drawn this turn"), counts.get(0).text());
    }

    @Test
    public void handSizeAndLifeAreCounts() {
        Game game = game();
        Player me = game.getPlayers().get(0);
        Card maro = add("Maro", me, ZoneType.Battlefield);
        add("Forest", me, ZoneType.Hand);
        add("Forest", me, ZoneType.Hand);
        assertEquals(CardCounts.of(maro).get(0).value(), 2);
        Card avatar = add("Serra Avatar", me, ZoneType.Battlefield);
        assertEquals(CardCounts.of(avatar).get(0).value(), 20);
    }

    @Test
    public void costsPaidAreLeftOut() {
        Game game = game();
        Player me = game.getPlayers().get(0);
        assertTrue(CardCounts.of(add("Fireball", me, ZoneType.Hand)).isEmpty()); // X is paid on casting
    }

    /** A big board, 150 creatures of which every tenth counts the board: what one decision point's counts cost. */
    @Test
    public void bigBoardCost() {
        Game game = game();
        Player me = game.getPlayers().get(0);
        List<Card> all = new ArrayList<>();
        for (int i = 0; i < 150; i++) {
            all.add(add(i % 10 == 0 ? "Goblin Piledriver" : i % 10 == 5 ? "Blasphemous Act" : "Goblin Piker", me, i % 10 == 5 ? ZoneType.Hand : ZoneType.Battlefield));
        }
        long best = Long.MAX_VALUE;
        for (int round = 0; round < 20; round++) {
            long t0 = System.nanoTime();
            for (Card c : all) {
                CardCounts.of(c);
            }
            best = Math.min(best, System.nanoTime() - t0);
        }
        System.out.printf("counts on 150 cards, 30 counting: %.2f ms%n", best / 1e6);
        assertEquals(CardCounts.of(all.get(5)).get(0).value(), 135); // Blasphemous Act: the creatures on the battlefield
    }

    /** Every card script: how many have counts, which fail, and whether each label is a line of the card's text. */
    @Test
    public void sweep() throws IOException {
        if (!Boolean.getBoolean("counts.sweep")) {
            return;
        }
        Game game = game();
        Player me = game.getPlayers().get(0);
        List<String> errors = new ArrayList<>();
        List<String> unmatched = new ArrayList<>();
        List<String> found = new ArrayList<>();
        int cards = 0;
        long nanos = 0;
        Path folder = Path.of("..", "forge-gui", "res", "cardsfolder");
        List<Path> files;
        try (Stream<Path> s = Files.walk(folder)) {
            files = s.filter(f -> f.toString().endsWith(".txt")).sorted().toList();
        }
        for (Path f : files) {
            String name = Files.readAllLines(f).stream().filter(l -> l.startsWith("Name:")).findFirst().map(l -> l.substring(5).trim()).orElse(null);
            if (name == null) {
                continue;
            }
            Card c;
            try {
                c = add(name, me, ZoneType.Battlefield);
            } catch (RuntimeException e) {
                continue;
            }
            cards++;
            long t0 = System.nanoTime();
            List<CardCounts.Count> counts = CardCounts.of(c, errors);
            nanos += System.nanoTime() - t0;
            String text = c.getView().getText(c.getView().getCurrentState(), null);
            for (CardCounts.Count n : counts) {
                found.add(name + " | " + n.name() + "=" + n.value() + " | " + n.text());
                if (text == null || !text.contains(n.text())) {
                    unmatched.add(name + " | " + n.text());
                }
            }
            me.getZone(ZoneType.Battlefield).remove(c);
        }
        Path out = Path.of(System.getProperty("java.io.tmpdir"), "card-counts");
        Files.createDirectories(out);
        Files.write(out.resolve("found.txt"), found);
        Files.write(out.resolve("errors.txt"), errors);
        Files.write(out.resolve("unmatched.txt"), unmatched);
        System.out.printf("counts sweep: %d cards, %d counts, %d errors, %d labels not in the text, %.1f us a card; lists in %s%n",
                cards, found.size(), errors.size(), unmatched.size(), nanos / 1000.0 / cards, out);
    }
}
