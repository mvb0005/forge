package forge.web;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import forge.StaticData;
import forge.card.ColorSet;
import forge.card.MagicColor;
import forge.deck.Deck;
import forge.deck.DeckgenUtil;
import forge.deck.io.DeckSerializer;
import forge.game.GameType;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgeConstants;
import forge.model.FModel;
import forge.util.MyRandom;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Decks a match spec can name: a decklist's text (TrackerDeck), Forge's generated and precon decks by id
 * (development and the smoke test), and the curated opponents' commander precons.
 */
final class Decks {
    /** Filenames in res/quest/precons, without the extension. Constructed theme decks, not commander lists. */
    private static final String[] PRECONS = {
            "Angelic Might",
            "Spellweaver",
            "Zombies Unleashed",
            "Goblin Assault",
            "Elvish Predation",
            "Azorius Guild Kit",
            "Dimir Guild Kit",
            "Rakdos Guild Kit",
            "Gruul Guild Kit",
            "Selesnya Guild Kit",
            "Orzhov Guild Kit",
            "Izzet Guild Kit",
            "Golgari Guild Kit",
            "Simic Guild Kit",
            "Boros Guild Kit",
            "Sliver Evolution",
            "Sarkhan, Dragonsoul",
            "Morph Mayhem",
            "Huatli, Dinosaur Knight",
            "Vampire Onslaught",
    };
    private static volatile List<Deck> loadedPrecons;
    /** "Arcane Wizardry [C17] [2017]": name, set, year. */
    private static final Pattern PRECON_FILE = Pattern.compile("^(.*?) \\[([^\\]]+)\\] \\[(\\d{4})\\]$");
    private static volatile List<CommanderPrecon> commanderPrecons;

    /** A commander precon; the deck itself is read when a match starts. */
    private record CommanderPrecon(
            String file, String name, String detail, String colors,
            String manaCost, String typeLine, String oracleText, String pt, String img) {}

    private Decks() {
    }

    /** The curated opponents the control API offers, each with its precon's name, colours and commander card info. */
    static JsonArray curatedOpponents() {
        Map<String, CommanderPrecon> byFile = new LinkedHashMap<>();
        for (CommanderPrecon p : commanderPrecons()) {
            byFile.put(p.file(), p);
        }
        JsonArray out = new JsonArray();
        for (Opponents.Opponent o : Opponents.ROSTER) {
            CommanderPrecon p = byFile.get(o.precon());
            if (p == null) {
                System.err.println("Curated opponent " + o.id() + " has no precon " + o.precon());
                continue;
            }
            JsonObject j = new JsonObject();
            j.addProperty("id", o.id());
            j.addProperty("commander", o.commander());
            j.addProperty("archetype", o.archetype());
            j.addProperty("plan", o.plan());
            j.addProperty("deck", p.name());
            j.addProperty("colors", p.colors());
            j.addProperty("profile", o.profile());
            j.addProperty("manaCost", p.manaCost());
            j.addProperty("typeLine", p.typeLine());
            j.addProperty("oracleText", p.oracleText());
            j.addProperty("pt", p.pt());
            if (p.img() != null) {
                j.addProperty("img", p.img());
            }
            out.add(j);
        }
        return out;
    }

    /** Indexes the commander precons in the background, so the first match doesn't wait for it. */
    static void warmUp() {
        Thread index = new Thread(Decks::commanderPrecons, "commander-precons");
        index.setDaemon(true);
        index.start();
    }

    static String commanderColors(List<PaperCard> commanders) {
        int mask = 0;
        for (PaperCard c : commanders) {
            mask |= c.getRules().getColorIdentity().getColor();
        }
        return ViewProjector.colors(ColorSet.fromMask(mask));
    }

    /**
     * The commander precons by file name, with the commanders' colour identity. Only each file's
     * [Commander] lines are read (looked up in the card db); the whole deck is parsed when a match starts.
     */
    private static List<CommanderPrecon> commanderPrecons() {
        List<CommanderPrecon> cached = commanderPrecons;
        if (cached != null) {
            return cached;
        }
        synchronized (CommanderPrecon.class) {
            if (commanderPrecons != null) {
                return commanderPrecons;
            }
            long t0 = System.nanoTime();
            List<CommanderPrecon> list = new ArrayList<>();
            File[] files = new File(ForgeConstants.COMMANDER_PRECON_DIR).listFiles((d, n) -> n.endsWith(".dck"));
            if (files != null) {
                Arrays.sort(files);
                for (File f : files) {
                    String file = f.getName().substring(0, f.getName().length() - 4);
                    Matcher m = PRECON_FILE.matcher(file);
                    String name = m.matches() ? m.group(1) : file;
                    String detail = m.matches() ? m.group(2) + " · " + m.group(3) : "";
                    try {
                        List<PaperCard> cmds = commandersIn(f.toPath());
                        PaperCard lead = cmds.isEmpty() ? null : cmds.get(0);
                        var rules = lead == null ? null : lead.getRules();
                        String manaCost = rules == null || rules.getManaCost() == null || rules.getManaCost().isNoCost()
                                ? "" : rules.getManaCost().toString();
                        String typeLine = rules == null || rules.getType() == null
                                ? "" : rules.getType().toString().replace(" - ", " — ");
                        String oracleText = rules == null || rules.getOracleText() == null ? "" : rules.getOracleText();
                        String pt = rules != null && rules.getType() != null && rules.getType().isCreature()
                                ? rules.getPower() + "/" + rules.getToughness() : "";
                        String img = WebServer.scryfallUrl(lead, "");
                        list.add(new CommanderPrecon(
                                file, name, detail, commanderColors(cmds),
                                manaCost, typeLine, oracleText, pt, img));
                    } catch (Exception e) {
                        System.err.println("Skipping commander precon " + f + ": " + e);
                    }
                }
            }
            System.err.println("Indexed " + list.size() + " commander precons in " + (System.nanoTime() - t0) / 1_000_000 + " ms");
            commanderPrecons = list;
            return list;
        }
    }

    private static List<PaperCard> commandersIn(Path file) throws java.io.IOException {
        List<PaperCard> out = new ArrayList<>();
        boolean in = false;
        for (String line : Files.readAllLines(file)) {
            String l = line.trim();
            if (l.startsWith("[")) {
                in = l.equalsIgnoreCase("[Commander]");
                continue;
            }
            if (!in || l.isEmpty()) {
                continue;
            }
            String name = l.replaceFirst("^\\d+\\s+", "");
            int bar = name.indexOf('|');
            if (bar >= 0) {
                name = name.substring(0, bar);
            }
            PaperCard c = StaticData.instance().getCommonCards().getCard(name.trim());
            if (c != null) {
                out.add(c);
            }
        }
        return out;
    }

    /** cmdr:random, cmdr:precon:&lt;file&gt; or cmdr:deck:&lt;name&gt; (Forge's own deck folder). */
    static Deck commanderDeck(String id, boolean forAi) {
        Deck deck = null;
        if ("cmdr:random".equals(id)) {
            deck = DeckgenUtil.generateCommanderDeck(forAi, GameType.Commander);
        } else if (id != null && id.startsWith("cmdr:precon:")) {
            File f = new File(ForgeConstants.COMMANDER_PRECON_DIR, id.substring("cmdr:precon:".length()) + ".dck");
            if (f.isFile()) {
                deck = DeckSerializer.fromFile(f);
            }
        } else if (id != null && id.startsWith("cmdr:deck:")) {
            deck = FModel.getDecks().getCommander().get(id.substring("cmdr:deck:".length()));
        }
        if (deck == null) {
            throw new IllegalArgumentException("Unknown commander deck " + id);
        }
        if (deck.getCommanders().isEmpty()) {
            throw new IllegalArgumentException(deck.getName() + " has no commander");
        }
        return deck;
    }

    /** A precon id no other seat has (while there are enough). */
    static String randomPrecon(Set<String> taken) {
        List<String> ids = new ArrayList<>();
        for (CommanderPrecon p : commanderPrecons()) {
            String id = "cmdr:precon:" + p.file();
            if (!taken.contains(id)) {
                ids.add(id);
            }
        }
        if (ids.isEmpty()) {
            for (CommanderPrecon p : commanderPrecons()) {
                ids.add("cmdr:precon:" + p.file());
            }
        }
        if (ids.isEmpty()) {
            throw new IllegalArgumentException("No commander precons found");
        }
        Collections.shuffle(ids, MyRandom.getRandom());
        return ids.get(0);
    }

    /** "Arcane Wizardry" for a precon's "Arcane Wizardry [C17] [2017]". */
    static String shortName(Deck deck) {
        String n = deck.getName() == null ? "" : deck.getName();
        Matcher m = PRECON_FILE.matcher(n);
        return m.matches() ? m.group(1) : n;
    }

    /** random:&lt;colours&gt;, deck:&lt;name&gt; (Forge's own deck folder) or precon:&lt;name&gt;. */
    static Deck constructedDeck(String id) {
        if (id != null && id.startsWith("random:")) {
            List<String> names = new ArrayList<>();
            for (char c : id.substring("random:".length()).toUpperCase().toCharArray()) {
                byte color = MagicColor.fromName(c);
                if (color != 0) {
                    names.add(MagicColor.toLongString(color));
                }
            }
            if (names.isEmpty()) {
                throw new IllegalArgumentException("Bad deck id " + id);
            }
            return DeckgenUtil.buildColorDeck(names, null, true);
        }
        if (id != null && id.startsWith("deck:")) {
            Deck d = FModel.getDecks().getConstructed().get(id.substring("deck:".length()));
            if (d != null) {
                return d;
            }
        }
        if (id != null && id.startsWith("precon:")) {
            String name = id.substring("precon:".length());
            for (Deck d : precons()) {
                if (name.equals(d.getName())) {
                    return d;
                }
            }
        }
        throw new IllegalArgumentException("Unknown deck " + id);
    }

    private static List<Deck> precons() {
        List<Deck> cached = loadedPrecons;
        if (cached != null) {
            return cached;
        }
        synchronized (Decks.class) {
            if (loadedPrecons != null) {
                return loadedPrecons;
            }
            List<Deck> loaded = new ArrayList<>();
            for (String name : PRECONS) {
                File file = new File(ForgeConstants.QUEST_PRECON_DIR, name + ".dck");
                try {
                    Deck deck = DeckSerializer.fromFile(file);
                    if (deck == null || deck.getMain() == null || deck.getMain().isEmpty()) {
                        System.err.println("Skipping precon " + file);
                        continue;
                    }
                    loaded.add(deck);
                } catch (Exception e) {
                    System.err.println("Skipping precon " + name);
                    e.printStackTrace();
                }
            }
            loadedPrecons = loaded;
            return loaded;
        }
    }
}
