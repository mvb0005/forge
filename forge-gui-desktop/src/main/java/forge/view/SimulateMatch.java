package forge.view;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.apache.commons.lang3.time.StopWatch;

import com.google.common.eventbus.Subscribe;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.DoubleHistogram;
import io.opentelemetry.api.metrics.LongHistogram;
import io.opentelemetry.api.metrics.Meter;

import forge.LobbyPlayer;
import forge.ai.AiProfileUtil;
import forge.deck.Deck;
import forge.deck.DeckGroup;
import forge.deck.io.DeckSerializer;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.GameLogEntry;
import forge.game.GameLogEntryType;
import forge.game.GameRules;
import forge.game.GameState;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.event.GameEventTurnPhase;
import forge.game.phase.PhaseType;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.tournament.system.AbstractTournament;
import forge.gamemodes.tournament.system.TournamentBracket;
import forge.gamemodes.tournament.system.TournamentPairing;
import forge.gamemodes.tournament.system.TournamentPlayer;
import forge.gamemodes.tournament.system.TournamentRoundRobin;
import forge.gamemodes.tournament.system.TournamentSwiss;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgeConstants;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.util.Lang;
import forge.util.MyRandom;
import forge.util.TextUtil;
import forge.util.WordUtil;
import forge.util.storage.IStorage;

public class SimulateMatch {
    // state: board to start every game from (-state)
    // dumpTurn/dumpDir: write the board at main phase 1 of that turn, or right after the state loads when 0 (-dump)
    // aiTimeout: seconds per AI decision, 0 = the game default (-aitimeout)
    private record SimOptions(GameState state, String scenario, int dumpTurn, File dumpDir, Long seed, int aiTimeout) {
        static final SimOptions NONE = new SimOptions(null, "full-game", -1, null, null, 0);
    }

    // exported only when the OpenTelemetry Java agent is attached (see bench/)
    private static final Meter METER = GlobalOpenTelemetry.getMeter("forge.sim");
    private static final DoubleHistogram GAME_DURATION = METER.histogramBuilder("forge.game.duration")
            .setUnit("s").setDescription("Wall time of one simulated game")
            .setExplicitBucketBoundariesAdvice(List.of(1.0, 2.0, 5.0, 10.0, 20.0, 30.0, 60.0, 120.0, 300.0, 600.0, 1800.0, 3600.0))
            .build();
    private static final LongHistogram GAME_TURNS = METER.histogramBuilder("forge.game.turns")
            .ofLongs().setDescription("Turns played in one simulated game")
            .setExplicitBucketBoundariesAdvice(List.of(4L, 6L, 8L, 10L, 12L, 15L, 20L, 30L, 50L))
            .build();
    // decks in turn order, e.g. "Inalla, Archmage Ritualist > Atraxa, Praetors' Voice > ..."
    private static final AttributeKey<String> MATCHUP = AttributeKey.stringKey("forge.matchup");
    // the same decks sorted, so every turn order of one pod groups together
    private static final AttributeKey<String> POD = AttributeKey.stringKey("forge.pod");
    // the state file a game started from, or full-game
    private static final AttributeKey<String> SCENARIO = AttributeKey.stringKey("forge.scenario");
    // the winning deck, or draw / timeout / error
    private static final AttributeKey<String> OUTCOME = AttributeKey.stringKey("forge.outcome");

    public static void simulate(String[] args) {
        FModel.initialize(null, null);

        System.out.println("Simulation mode");
        if (args.length < 4) {
            argumentHelp();
            return;
        }

        final Map<String, List<String>> params = new HashMap<>();
        List<String> options = null;

        for (int i = 1; i < args.length; i++) {
            // "sim" is in the 0th slot
            final String a = args[i];

            if (a.charAt(0) == '-') {
                if (a.length() < 2) {
                    System.err.println("Error at argument " + a);
                    argumentHelp();
                    return;
                }

                options = new ArrayList<>();
                params.put(a.substring(1), options);
            } else if (options != null) {
                options.add(a);
            } else {
                System.err.println("Illegal parameter usage");
                return;
            }
        }

        String deckDir = null;
        if (params.containsKey("D")) {
            deckDir = params.get("D").get(0);
        }

        int nGames = 1;
        if (params.containsKey("n")) {
            // Number of games should only be a single string
            nGames = Integer.parseInt(params.get("n").get(0));
        }

        int matchSize = 0;
        if (params.containsKey("m")) {
            // Match size ("best of X games")
            matchSize = Integer.parseInt(params.get("m").get(0));
        }

        boolean outputGamelog = !params.containsKey("q");

        Long seed = null;
        if (params.containsKey("s")) {
            seed = Long.parseLong(params.get("s").get(0));
            MyRandom.setRandom(new Random(seed));
        }

        GameType type = GameType.Constructed;
        if (params.containsKey("f")) {
            type = GameType.valueOf(WordUtil.capitalize(params.get("f").get(0)));
        }

        GameRules rules = new GameRules(type);
        rules.setAppliedVariants(EnumSet.of(type));

        if (matchSize != 0) {
            rules.setGamesPerMatch(matchSize);
        }

        if (params.containsKey("t")) {
            simulateTournament(params, rules, outputGamelog);
            System.out.flush();
            return;
        }

        List<RegisteredPlayer> pp = new ArrayList<>();
        StringBuilder sb = new StringBuilder();

        int i = 1;

        // Optional AI profile per player, in the same order as the decks. Lets a run pit one set of
        // AI settings against another, which is the only way to tell from the results whether an AI
        // change actually helped.
        List<String> aiProfiles = params.get("a");
        if (aiProfiles != null) {
            for (String profile : aiProfiles) {
                if (!AiProfileUtil.getProfilesDisplayList().contains(profile)) {
                    System.out.println(TextUtil.concatNoSpace("Unknown AI profile - ", profile,
                            ". Available profiles: ", String.join(", ", AiProfileUtil.getProfilesDisplayList())));
                    return;
                }
            }
        }

        GameState state = null;
        String scenario = "full-game";
        if (params.containsKey("state")) {
            File stateFile = new File(params.get("state").get(0));
            state = new GameState();
            try (InputStream in = new FileInputStream(stateFile)) {
                state.parse(in);
            } catch (Exception e) {
                System.out.println("Could not read state file " + stateFile + ": " + e.getMessage());
                return;
            }
            scenario = stateFile.getName();
            List<String> decks = params.get("d");
            if (decks != null && decks.size() != state.getPlayerCount()) {
                System.out.println(TextUtil.concatNoSpace("State has ", String.valueOf(state.getPlayerCount()), " players but ",
                        String.valueOf(decks.size()), " decks were given"));
                return;
            }
            if (decks == null) {
                // the state sets every zone, so players don't need decks
                for (int p = 1; p <= state.getPlayerCount(); p++) {
                    RegisteredPlayer rp = new RegisteredPlayer(new Deck());
                    rp.setPlayer(GamePlayerUtil.createAiPlayer("Ai(" + p + ")", p - 1, ""));
                    pp.add(rp);
                }
                sb.append(state.getPlayerCount()).append(" players from ").append(scenario);
            }
        }
        int dumpTurn = -1;
        File dumpDir = null;
        if (params.containsKey("dump")) {
            dumpTurn = Integer.parseInt(params.get("dump").get(0));
            dumpDir = new File(params.get("dump").size() > 1 ? params.get("dump").get(1) : ".");
            dumpDir.mkdirs();
        }
        int aiTimeout = params.containsKey("aitimeout") ? Integer.parseInt(params.get("aitimeout").get(0)) : 0;
        SimOptions opts = new SimOptions(state, scenario, dumpTurn, dumpDir, seed, aiTimeout);

        if (params.containsKey("d")) {
            for (String deck : params.get("d")) {
                Deck d = deckFromCommandLineParameter(deck, type, deckDir);
                if (d == null) {
                    System.out.println(TextUtil.concatNoSpace("Could not load deck - ", deck, ", match cannot start"));
                    return;
                }
                if (i > 1) {
                    sb.append(" vs ");
                }
                String profile = aiProfiles != null && aiProfiles.size() >= i ? aiProfiles.get(i - 1) : "";
                String name = TextUtil.concatNoSpace("Ai(", String.valueOf(i), ")-", d.getName());
                sb.append(name);
                if (!profile.isEmpty()) {
                    sb.append(" [").append(profile).append("]");
                }

                RegisteredPlayer rp;

                if (type.equals(GameType.Commander)) {
                    rp = RegisteredPlayer.forCommander(d);
                } else {
                    rp = new RegisteredPlayer(d);
                }
                rp.setPlayer(GamePlayerUtil.createAiPlayer(name, i - 1, profile));
                pp.add(rp);
                i++;
            }
        }

        if (params.containsKey("c")) {
            rules.setSimTimeout(Integer.parseInt(params.get("c").get(0)));
        }

        sb.append(" - ").append(Lang.nounWithNumeral(nGames, "game")).append(" of ").append(type);
        if (seed != null) {
            sb.append(" seed ").append(seed);
        }

        System.out.println(sb);

        if (state != null) {
            for (RegisteredPlayer rp : pp) {
                rp.setStartingHand(0);
            }
        }
        Match mc = new Match(rules, pp, "Test");

        if (matchSize != 0) {
            int iGame = 0;
            while (!mc.isMatchOver()) {
                // play games until the match ends
                simulateSingleMatch(mc, iGame, outputGamelog, opts);
                iGame++;
            }
        } else {
            for (int iGame = 0; iGame < nGames; iGame++) {
                simulateSingleMatch(mc, iGame, outputGamelog, opts);
            }
        }

        System.out.flush();
    }

    // commander names when the seat has commanders (from its deck or a loaded state), otherwise the deck name
    private static String seatLabel(Game game, Match mc, int seat) {
        List<String> names = new ArrayList<>();
        for (Card c : game.getRegisteredPlayers().get(seat).getCommanders()) {
            names.add(c.getName());
        }
        Deck deck = mc.getPlayers().get(seat).getDeck();
        if (names.isEmpty()) {
            for (PaperCard c : deck.getCommanders()) {
                names.add(c.getName());
            }
        }
        if (!names.isEmpty()) {
            return String.join(" + ", names);
        }
        return deck.getName() == null || deck.getName().isEmpty() ? "p" + seat : deck.getName();
    }

    // writes the board at the first main phase of the given turn, so a later run can start from it with -state
    private static void dumpStateAt(final Game game, final int iGame, final SimOptions opts) {
        game.subscribeToEvents(new Object() {
            boolean done;

            @Subscribe
            public void onPhase(GameEventTurnPhase e) {
                // "dev" is the phase change made while a state is being loaded, before its cards are in place
                if (done || e.phase() != PhaseType.MAIN1 || "dev".equals(e.phaseDesc())
                        || game.getPhaseHandler().getTurn() != opts.dumpTurn()) {
                    return;
                }
                done = true;
                writeState(game, iGame, opts, "-turn" + opts.dumpTurn());
            }
        });
    }

    private static void writeState(final Game game, final int iGame, final SimOptions opts, final String suffix) {
        GameState dump = new GameState();
        dump.initFromGame(game);
        File out = new File(opts.dumpDir(), TextUtil.concatNoSpace("seed", String.valueOf(opts.seed()), "-game",
                String.valueOf(iGame + 1), suffix, ".txt"));
        try {
            Files.writeString(out.toPath(), dump.toString());
            System.out.println("Dumped state to " + out);
        } catch (IOException ex) {
            System.out.println("Could not write " + out + ": " + ex.getMessage());
        }
    }

    private static void argumentHelp() {
        System.out.println("Syntax: forge.exe sim -d <deck1[.dck]> ... <deckX[.dck]> -D [D] -n [N] -m [M] -t [T] -p [P] -f [F] -s [S] -a [A] -q");
        System.out.println("\tsim - stands for simulation mode");
        System.out.println("\tdeck1 (or deck2,...,X) - constructed deck name or filename (has to be quoted when contains multiple words)");
        System.out.println("\tdeck is treated as file if it ends with a dot followed by three numbers or letters");
        System.out.println("\tD - absolute directory to load decks from");
        System.out.println("\tN - number of games, defaults to 1 (Ignores match setting)");
        System.out.println("\tM - Play full match of X games, typically 1,3,5 games. (Optional, overrides N)");
        System.out.println("\tT - Type of tournament to run with all provided decks (Bracket, RoundRobin, Swiss)");
        System.out.println("\tP - Amount of players per match (used only with Tournaments, defaults to 2)");
        System.out.println("\tF - format of games, defaults to constructed");
        System.out.println("\tS - RNG seed for simulation");
        System.out.println("\tA - AI profile per player, in the same order as the decks (e.g. -a Default Experimental)");
        System.out.println("\tc - Clock flag. Set the maximum time in seconds before calling the match a draw, defaults to 120.");
        System.out.println("\tq - Quiet flag. Output just the game result, not the entire game log.");
        System.out.println("\tstate - start every game from this game state file (as written by -dump or Dump Game State); -d is optional");
        System.out.println("\tdump - <turn> [dir]: write the board at main phase 1 of that turn to dir as a state file; with -state, 0 writes it right after loading");
        System.out.println("\taitimeout - seconds the AI may think per decision (default 5); set it high so a seed replays the same game exactly");
    }

    public static void simulateSingleMatch(final Match mc, int iGame, boolean outputGamelog) {
        simulateSingleMatch(mc, iGame, outputGamelog, SimOptions.NONE);
    }

    private static void simulateSingleMatch(final Match mc, int iGame, boolean outputGamelog, final SimOptions opts) {
        final StopWatch sw = new StopWatch();
        sw.start();

        final Game g1 = mc.createGame();
        g1.setNoGUIUser();
        if (opts.aiTimeout() > 0) {
            g1.AI_TIMEOUT = opts.aiTimeout();
        }
        if (opts.dumpTurn() > 0) {
            dumpStateAt(g1, iGame, opts);
        }
        Runnable startGameHook = null;
        if (opts.state() != null) {
            startGameHook = () -> {
                opts.state().applyToGameNow(g1);
                if (opts.dumpTurn() == 0) {
                    writeState(g1, iGame, opts, "-loaded");
                }
            };
        }
        final Runnable hook = startGameHook;
        String outcome = null;
        // will run match in the same thread
        try {
            TimeLimitedCodeBlock.runWithTimeout(() -> {
                mc.startGame(g1, hook);
                sw.stop();
            }, mc.getRules().getSimTimeout(), TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            System.out.println("Stopping slow match as draw");
            outcome = "timeout";
        } catch (Exception | StackOverflowError e) {
            e.printStackTrace();
            outcome = "error";
        } finally {
            if (sw.isStarted()) {
                sw.stop();
            }
            g1.setGameOver(GameEndReason.Draw);
        }
        if (outcome == null) {
            RegisteredPlayer winner = g1.getOutcome().getWinningPlayer();
            outcome = winner == null ? "draw" : seatLabel(g1, mc, mc.getPlayers().indexOf(winner));
        }
        int seats = mc.getPlayers().size();
        int first = Math.max(0, g1.getRegisteredPlayers().indexOf(g1.getStartingPlayer()));
        List<String> turnOrder = new ArrayList<>();
        for (int i = 0; i < seats; i++) {
            turnOrder.add(seatLabel(g1, mc, (first + i) % seats));
        }
        List<String> pod = new ArrayList<>(turnOrder);
        Collections.sort(pod);
        Attributes attrs = Attributes.builder().put(MATCHUP, String.join(" > ", turnOrder)).put(POD, String.join(", ", pod))
                .put(OUTCOME, outcome).put(SCENARIO, opts.scenario()).build();
        GAME_DURATION.record(sw.getTime() / 1000.0, attrs);
        GAME_TURNS.record(g1.getPhaseHandler().getTurn(), attrs);

        List<GameLogEntry> log;
        if (outputGamelog) {
            log = g1.getGameLog().getLogEntries(null);
        } else {
            log = g1.getGameLog().getLogEntries(GameLogEntryType.MATCH_RESULTS);
        }
        Collections.reverse(log);
        for (GameLogEntry l : log) {
            System.out.println(l);
        }

        // If both players life totals to 0 in a single turn, the game should end in a draw
        if (g1.getOutcome().isDraw()) {
            System.out.printf("\nGame Result: Game %d ended in a Draw! Took %d ms.%n", 1 + iGame, sw.getTime());
        } else {
            System.out.printf("\nGame Result: Game %d ended in %d ms. %s has won!\n%n", 1 + iGame, sw.getTime(), g1.getOutcome().getWinningLobbyPlayer().getName());
        }
    }

    private static void simulateTournament(Map<String, List<String>> params, GameRules rules, boolean outputGamelog) {
        String tournament = params.get("t").get(0);
        AbstractTournament tourney = null;
        int matchPlayers = params.containsKey("p") ? Integer.parseInt(params.get("p").get(0)) : 2;

        DeckGroup deckGroup = new DeckGroup("SimulatedTournament");
        List<TournamentPlayer> players = new ArrayList<>();
        int numPlayers = 0;
        if (params.containsKey("d")) {
            for (String deck : params.get("d")) {
                Deck d = deckFromCommandLineParameter(deck, rules.getGameType(), null);
                if (d == null) {
                    System.out.println(TextUtil.concatNoSpace("Could not load deck - ", deck, ", match cannot start"));
                    return;
                }

                deckGroup.addAiDeck(d);
                players.add(new TournamentPlayer(GamePlayerUtil.createAiPlayer(d.getName(), 0), numPlayers));
                numPlayers++;
            }
        }

        if (params.containsKey("D")) {
            // Load decks from the specified directory
            String foldName = params.get("D").get(0);
            File folder = new File(foldName);
            if (!folder.isDirectory()) {
                System.out.println("Directory not found - " + foldName);
            } else {
                for (File deck : folder.listFiles((dir, name) -> name.endsWith(".dck"))) {
                    Deck d = DeckSerializer.fromFile(deck);
                    if (d == null) {
                        System.out.println(TextUtil.concatNoSpace("Could not load deck - ", deck.getName(), ", match cannot start"));
                        return;
                    }
                    deckGroup.addAiDeck(d);
                    players.add(new TournamentPlayer(GamePlayerUtil.createAiPlayer(d.getName(), 0), numPlayers));
                    numPlayers++;
                }
            }
        }

        if (numPlayers == 0) {
            System.out.println("No decks/Players found. Please try again.");
        }

        if ("bracket".equalsIgnoreCase(tournament)) {
            tourney = new TournamentBracket(players, matchPlayers);
        } else if ("roundrobin".equalsIgnoreCase(tournament)) {
            tourney = new TournamentRoundRobin(players, matchPlayers);
        } else if ("swiss".equalsIgnoreCase(tournament)) {
            tourney = new TournamentSwiss(players, matchPlayers);
        }
        if (tourney == null) {
            System.out.println("Failed to initialize tournament, bailing out");
            return;
        }

        tourney.initializeTournament();

        String lastWinner = "";
        int curRound = 0;
        System.out.println(TextUtil.concatNoSpace("Starting a ", tournament, " tournament with ",
                String.valueOf(numPlayers), " players over ",
                String.valueOf(tourney.getTotalRounds()), " rounds"));
        while (!tourney.isTournamentOver()) {
            if (tourney.getActiveRound() != curRound) {
                if (curRound != 0) {
                    System.out.println(TextUtil.concatNoSpace("End Round - ", String.valueOf(curRound)));
                }
                curRound = tourney.getActiveRound();
                System.out.println();
                System.out.println(TextUtil.concatNoSpace("Round ", String.valueOf(curRound), " Pairings:"));

                for (TournamentPairing pairing : tourney.getActivePairings()) {
                    System.out.println(pairing.outputHeader());
                }
                System.out.println();
            }

            TournamentPairing pairing = tourney.getNextPairing();
            List<RegisteredPlayer> regPlayers = AbstractTournament.registerTournamentPlayers(pairing, deckGroup);

            StringBuilder sb = new StringBuilder();
            sb.append("Round ").append(tourney.getActiveRound()).append(" - ");
            sb.append(pairing.outputHeader());
            System.out.println(sb.toString());

            if (!pairing.isBye()) {
                Match mc = new Match(rules, regPlayers, "TourneyMatch");

                int exceptions = 0;
                int iGame = 0;
                while (!mc.isMatchOver()) {
                    // play games until the match ends
                    try {
                        simulateSingleMatch(mc, iGame, outputGamelog);
                        iGame++;
                    } catch (Exception e) {
                        exceptions++;
                        System.out.println(e.toString());
                        if (exceptions > 5) {
                            System.out.println("Exceeded number of exceptions thrown. Abandoning match...");
                            break;
                        } else {
                            System.out.println("Game threw exception. Abandoning game and continuing...");
                        }
                    }

                }
                LobbyPlayer winner = mc.getWinner().getPlayer();
                for (TournamentPlayer tp : pairing.getPairedPlayers()) {
                    if (winner.equals(tp.getPlayer())) {
                        pairing.setWinner(tp);
                        lastWinner = winner.getName();
                        System.out.println(TextUtil.concatNoSpace("Match Winner - ", lastWinner, "!"));
                        System.out.println();
                        break;
                    }
                }
            }

            tourney.reportMatchCompletion(pairing);
        }
        tourney.outputTournamentResults();
    }

    public static Match simulateOffthreadGame(List<Deck> decks, GameType format, int games) {
        return null;
    }

    private static Deck deckFromCommandLineParameter(String deckname, GameType type, String deckDir) {
        int dotpos = deckname.lastIndexOf('.');
        if (dotpos > 0 && dotpos == deckname.length() - 4) {
            String baseDir = deckDir != null ? deckDir : (type.equals(GameType.Commander) ?
                    ForgeConstants.DECK_COMMANDER_DIR : ForgeConstants.DECK_CONSTRUCTED_DIR);

            if (!baseDir.endsWith(File.separator)) {
                baseDir += File.separator;
            }

            File f = new File(baseDir + deckname);
            if (!f.exists()) {
                System.out.println("No deck found in " + baseDir);
            }

            return DeckSerializer.fromFile(f);
        }

        IStorage<Deck> deckStore = null;

        // Add other game types here...
        if (type.equals(GameType.Commander)) {
            deckStore = FModel.getDecks().getCommander();
        } else {
            deckStore = FModel.getDecks().getConstructed();
        }

        return deckStore.get(deckname);
    }

}
