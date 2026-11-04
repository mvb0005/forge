package forge.web;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertFalse;
import static org.testng.Assert.assertNotNull;
import static org.testng.Assert.assertNull;
import static org.testng.Assert.assertTrue;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

import forge.StaticData;
import forge.ai.AvailableActions;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.YieldController;
import forge.gamemodes.match.YieldUpdate;
import forge.gui.GuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

/**
 * The engine side of auto-passing (docs/AUTOPASS.md): which steps ask a seat, when its own spell passes, what the
 * engine counts as something to do, and the "pass until …" yields on upstream's YieldController. No sockets: a real
 * game, set up in place. Needs forge-gui/res; point APPDATA/LOCALAPPDATA at a scratch folder.
 */
public class AutoPassTest {
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

    private static Game game(int players) {
        List<RegisteredPlayer> regs = new ArrayList<>();
        String[] names = {"Me", "Ann", "Ben", "Cat"};
        for (int i = 0; i < players; i++) {
            regs.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi(names[i], null)));
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

    private static void at(Game game, PhaseType phase, Player turn) {
        game.getPhaseHandler().devModeSet(phase, turn, false);
    }

    private static void attack(Game game, Player attacker, Card creature, Object defender) {
        Combat combat = new Combat(attacker);
        combat.addAttacker(creature, (forge.game.GameEntity) defender);
        game.getPhaseHandler().setCombat(combat);
    }

    private static SpellAbility cast(Game game, Player who, String name, Object target) {
        Card c = add(name, who, ZoneType.Hand);
        SpellAbility sa = c.getFirstSpellAbility();
        sa.setActivatingPlayer(who);
        if (target != null) {
            sa.getTargets().add((forge.game.GameObject) target);
        }
        game.getStack().add(sa);
        return sa;
    }

    private static boolean stops(Game game, Player seat) {
        return Stops.stopsAt(game, seat, game.getPhaseHandler().getPlayerTurn(), game.getPhaseHandler().getPhase());
    }

    // ------------------------------------------------------------------ stops

    @Test
    public void ownTurnStopsAreTheMainPhasesAndCombat() {
        Game g = game(2);
        Player me = g.getPlayers().get(0);
        for (PhaseType p : PhaseType.values()) {
            at(g, p, me);
            boolean expected = p == PhaseType.MAIN1 || p == PhaseType.MAIN2 || p == PhaseType.COMBAT_DECLARE_ATTACKERS
                    || p == PhaseType.COMBAT_DECLARE_BLOCKERS || p == PhaseType.COMBAT_FIRST_STRIKE_DAMAGE;
            assertEquals(stops(g, me), expected, p.toString());
        }
    }

    @Test
    public void theirEndStepAlwaysStopsTheirMainPhasesNever() {
        Game g = game(4);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1);
        at(g, PhaseType.END_OF_TURN, ann);
        assertTrue(stops(g, me));
        at(g, PhaseType.MAIN1, ann);
        assertFalse(stops(g, me));
        at(g, PhaseType.UPKEEP, ann);
        assertFalse(stops(g, me));
    }

    @Test
    public void theirBeginningOfCombatStopsOnlyInOneVersusOne() {
        Game duel = game(2);
        at(duel, PhaseType.COMBAT_BEGIN, duel.getPlayers().get(1));
        assertTrue(stops(duel, duel.getPlayers().get(0)));
        Game pod = game(4);
        at(pod, PhaseType.COMBAT_BEGIN, pod.getPlayers().get(1));
        assertFalse(stops(pod, pod.getPlayers().get(0)), "in a pod you can't tell yet whom they attack");
    }

    @Test
    public void theirCombatStopsOnlyWhenItInvolvesYou() {
        Game g = game(3);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1), ben = g.getPlayers().get(2);
        Card bear = add("Grizzly Bears", ann, ZoneType.Battlefield);
        at(g, PhaseType.COMBAT_DECLARE_ATTACKERS, ann);
        attack(g, ann, bear, ben);
        assertFalse(stops(g, me), "Ann attacks Ben: not my combat");
        assertTrue(stops(g, ben));
        at(g, PhaseType.COMBAT_DECLARE_BLOCKERS, ann);
        assertFalse(stops(g, me));
        at(g, PhaseType.COMBAT_DECLARE_ATTACKERS, ann);
        attack(g, ann, bear, me);
        assertTrue(stops(g, me), "Ann attacks me");
    }

    @Test
    public void anAttackOnYourPlaneswalkerInvolvesYou() {
        Game g = game(3);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1);
        Card bear = add("Grizzly Bears", ann, ZoneType.Battlefield);
        Card walker = add("Jace Beleren", me, ZoneType.Battlefield);
        at(g, PhaseType.COMBAT_DECLARE_ATTACKERS, ann);
        attack(g, ann, bear, walker);
        assertTrue(stops(g, me));
        assertTrue(Stops.inCombat(g, me));
        assertFalse(Stops.inCombat(g, g.getPlayers().get(2)));
    }

    // ------------------------------------------------------------------ your own spell on top

    @Test
    public void ownSpellOnTopPassesSomeoneElsesDoesNot() {
        Game g = game(2);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1);
        assertFalse(Stops.ownTop(g, me), "empty stack");
        cast(g, me, "Lightning Bolt", ann);
        assertTrue(Stops.ownTop(g, me), "my Bolt on top: I just cast it");
        assertFalse(Stops.ownTop(g, ann));
        cast(g, ann, "Lightning Bolt", me);
        assertFalse(Stops.ownTop(g, me), "Ann responded: her Bolt is on top");
    }

    // ------------------------------------------------------------------ what counts as something to do

    @Test
    public void landsAndManaAbilitiesAloneAreNothingToDo() {
        Game g = game(2);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1);
        add("Island", me, ZoneType.Battlefield);
        add("Island", me, ZoneType.Battlefield);
        add("Sol Ring", me, ZoneType.Battlefield);
        add("Forest", me, ZoneType.Hand);
        at(g, PhaseType.MAIN1, ann);
        cast(g, ann, "Lightning Bolt", me);
        assertFalse(AvailableActions.compute(me, 1500), "tapping lands with nothing to spend on is not an action");
    }

    @Test
    public void aCounterspellWithManaIsSomethingToDoWithoutManaItIsNot() {
        Game g = game(2);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1);
        add("Counterspell", me, ZoneType.Hand);
        at(g, PhaseType.MAIN1, ann);
        cast(g, ann, "Lightning Bolt", me);
        assertFalse(AvailableActions.compute(me, 1500), "no mana for it");
        add("Island", me, ZoneType.Battlefield);
        add("Island", me, ZoneType.Battlefield);
        assertTrue(AvailableActions.compute(me, 1500), "UU open and a spell to counter");
    }

    @Test
    public void aFetchlandStillCountsAsSomethingToDo() {
        // The known gap M14.2's mutes close: a non-mana ability you can pay for always counts.
        Game g = game(2);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1);
        add("Evolving Wilds", me, ZoneType.Battlefield);
        at(g, PhaseType.END_OF_TURN, ann);
        assertTrue(AvailableActions.compute(me, 1500));
    }

    // ------------------------------------------------------------------ yields

    private static YieldController seatYields() {
        YieldController yc = new YieldController(null);
        Yields.seatDefaults(yc);
        return yc;
    }

    @Test
    public void seatDefaultsStayOffTheSharedPreferences() {
        String shared = FModel.getPreferences().getPref(FPref.YIELD_INTERRUPT_ON_OPPONENT_SPELL);
        YieldController yc = seatYields();
        assertFalse(yc.getBoolPref(FPref.YIELD_INTERRUPT_ON_OPPONENT_SPELL));
        assertTrue(yc.getBoolPref(FPref.YIELD_INTERRUPT_ON_TARGETING));
        assertTrue(yc.getBoolPref(FPref.YIELD_INTERRUPT_ON_ATTACKERS));
        assertEquals(FModel.getPreferences().getPref(FPref.YIELD_INTERRUPT_ON_OPPONENT_SPELL), shared);
    }

    @Test
    public void untilAnnsEndStepEndsThereNotAtBensOrBefore() {
        Game g = game(3);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1), ben = g.getPlayers().get(2);
        at(g, PhaseType.MAIN1, me);
        YieldController yc = seatYields();
        YieldUpdate u = Yields.start("endStep", g, me, ann);
        assertNotNull(u);
        yc.apply(u);
        Yields.Running y = Yields.running(yc, g, me);
        assertEquals(y.kind(), "endStep");
        assertEquals(y.label(), "Passing until Ann's end step");
        at(g, PhaseType.END_OF_TURN, me);
        assertFalse(Yields.reached(y, g), "my own end step");
        at(g, PhaseType.COMBAT_DECLARE_BLOCKERS, ann);
        assertFalse(Yields.reached(y, g), "Ann's combat: not there yet");
        at(g, PhaseType.END_OF_TURN, ben);
        assertFalse(Yields.reached(y, g), "Ben's end step");
        at(g, PhaseType.END_OF_TURN, ann);
        assertTrue(Yields.reached(y, g));
    }

    @Test
    public void yieldsThatCantBeSetNowAreRefused() {
        Game g = game(2);
        Player me = g.getPlayers().get(0);
        assertNull(Yields.start("stack", g, me, null), "nothing on the stack to wait out");
        assertNull(Yields.start("endStep", g, me, me), "your own end step is not a yield target");
        assertNull(Yields.start("bogus", g, me, null));
        assertNotNull(Yields.start("nextTurn", g, me, null));
        assertNotNull(Yields.start("turn", g, me, null));
    }

    @Test
    public void untilMyNextTurnSetOnMyTurnWaitsForTheNextOne() {
        Game g = game(2);
        Player me = g.getPlayers().get(0);
        at(g, PhaseType.MAIN1, me);
        YieldController yc = seatYields();
        yc.apply(Yields.start("nextTurn", g, me, null));
        Yields.Running y = Yields.running(yc, g, me);
        assertEquals(y.label(), "Passing until your next turn");
        // the marker is set at or past its step this turn, so upstream waits for the next occurrence
        assertNotNull(yc.getAutoPassUntilMarker());
    }

    @Test
    public void whyNamesTheSpellAndWhatItTargets() {
        Game g = game(2);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1);
        Card bear = add("Grizzly Bears", me, ZoneType.Battlefield);
        at(g, PhaseType.MAIN1, ann);
        cast(g, ann, "Lightning Bolt", bear);
        assertEquals(Yields.why(g, me), "Ann cast Lightning Bolt targeting your Grizzly Bears");
        cast(g, ann, "Lightning Bolt", me);
        assertEquals(Yields.why(g, me), "Ann cast Lightning Bolt targeting you");
    }

    @Test
    public void whyNamesTheAttacker() {
        Game g = game(3);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1);
        Card bear = add("Grizzly Bears", ann, ZoneType.Battlefield);
        at(g, PhaseType.COMBAT_DECLARE_ATTACKERS, ann);
        attack(g, ann, bear, me);
        assertEquals(Yields.why(g, me), "Ann attacks you");
    }

    @Test
    public void stackYieldEndsWhenTheStackIsEmpty() {
        Game g = game(2);
        Player me = g.getPlayers().get(0), ann = g.getPlayers().get(1);
        at(g, PhaseType.MAIN1, ann);
        SpellAbility bolt = cast(g, ann, "Lightning Bolt", me);
        YieldController yc = seatYields();
        yc.apply(Yields.start("stack", g, me, null));
        Yields.Running y = Yields.running(yc, g, me);
        assertEquals(y.kind(), "stack");
        assertFalse(Yields.reached(y, g));
        g.getStack().remove(g.getStack().peek());
        assertTrue(Yields.reached(y, g));
        assertNotNull(bolt);
    }
}
