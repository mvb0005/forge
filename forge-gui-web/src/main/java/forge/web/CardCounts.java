package forge.web;

import forge.game.CardTraitBase;
import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.replacement.ReplacementEffect;
import forge.game.spellability.SpellAbility;
import forge.game.staticability.StaticAbility;
import forge.game.trigger.Trigger;
import forge.util.Lang;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The live numbers a card's abilities count ("for each card your opponents have drawn this turn", "equal to the
 * number of creatures you control"), worked out by the engine. A script names such a number with an SVar
 * ({@code SVar:X:PlayerCountOpponents$CardsDrawn}) that one of its abilities references ({@code Amount$ X}); each
 * referenced SVar that reads the board now, rather than a cost paid, a target or a resolving ability, is one count,
 * labelled with that ability's text. Only the game's thread may call this.
 */
final class CardCounts {
    record Count(String text, String name, int value) {}

    private record Ref(CardTraitBase trait, String text, String name, String expr) {}

    /** What the board can answer at any time. */
    private static final Pattern LIVE = Pattern.compile("^(Count|PlayerCountOpponents|PlayerCountPlayers|PlayerCountPropertyYou|PlayerCountPropertyOpponents|SVar)\\$");
    /** Bound to a cast, a resolution or a choice (wrong outside it), private (a hand or library), random, or about the card itself (already on it). */
    private static final Pattern BOUND = Pattern.compile("Remembered|Targeted|Trigger|Imprinted|Sacrificed|Discarded|Defined|Parent|ChosenNumber"
            + "|xPaid|xColorPaid|Paid|Kicked|Spent|Converge|Bargained|Gift|Adamant|wasCast|IfCast|AltCost|Optional|Produced|ManaPool|Random|Compare|PlayerCountPlayers\\$Amount"
            + "|ValidHand (?!Card(\\.YouOwn|\\.OppOwn)?(/|$))|Library|Count\\$Card[A-Z]|Count\\$Last|LKI|Stored");
    /** {@code Count$Morbid.3.0}: a yes/no condition, not a count. */
    private static final Pattern CONDITIONAL = Pattern.compile("\\.-?\\d+\\.-?\\d+($|/)");
    private static final Pattern WORD = Pattern.compile("[A-Za-z][A-Za-z0-9]*");
    private static final Pattern ABILITY = Pattern.compile("^(AB|SP|DB|ST)\\$");
    private static final Pattern NAMED = Pattern.compile("(?:SVar\\$|/[A-Za-z]+\\.)([A-Za-z][A-Za-z0-9]*)");

    /** Which SVars each trait counts. Traits' ids are unique in the process (an LKI copy shares its original's, and its script). */
    private static final Map<CardTraitBase, Set<String>> PARSED = Collections.synchronizedMap(new WeakHashMap<>());

    private CardCounts() {}

    static List<Count> of(Card c) {
        return of(c, null);
    }

    /** {@code errors}, if given, collects the scripts that failed to evaluate (the sweep in CardCountsTest). */
    static List<Count> of(Card c, List<String> errors) {
        List<Count> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Ref r : refs(c, errors)) {
            if (!seen.add(r.text + "\u0000" + r.name)) {
                continue;
            }
            try {
                out.add(new Count(r.text, r.name, AbilityUtils.calculateAmount(c, r.expr, r.trait)));
            } catch (RuntimeException e) {
                // a script this can't evaluate out of context: leave it out
                if (errors != null) {
                    errors.add(c.getName() + " " + r.name + "=" + r.expr + ": " + e);
                }
            }
        }
        return out;
    }

    private static List<Ref> refs(Card c, List<String> errors) {
        List<Ref> out = new ArrayList<>();
        for (StaticAbility st : c.getStaticAbilities()) {
            add(out, st, st::toString, errors);
        }
        for (Trigger t : c.getTriggers()) {
            add(out, t, () -> t.replaceAbilityText(t.toString(), t.getCardState()), errors);
        }
        for (SpellAbility sa : c.getSpellAbilities()) {
            add(out, sa, sa::getDescription, errors);
        }
        for (ReplacementEffect re : c.getReplacementEffects()) {
            add(out, re, re::getDescription, errors);
        }
        return out;
    }

    private static void add(List<Ref> out, CardTraitBase trait, Supplier<String> describe, List<String> errors) {
        // keyword traits count for the keyword (affinity's artifacts), or keep the books on a paid cost (squad, replicate)
        if (trait.getKeyword() != null && !trait.getKeyword().getOriginal().startsWith("Affinity")) {
            return;
        }
        Set<String> found = PARSED.computeIfAbsent(trait, t -> {
            Set<String> f = new LinkedHashSet<>();
            scan(t, t.getMapParams(), f, new HashSet<>());
            return f.isEmpty() ? Set.of() : f;
        });
        if (found.isEmpty()) {
            return;
        }
        String text;
        try {
            text = describe.get();
        } catch (RuntimeException e) {
            if (errors != null) {
                errors.add(trait.getHostCard().getName() + " text: " + e);
            }
            return;
        }
        if (text == null || text.isBlank()) {
            return;
        }
        String name = trait.getHostCard().getName();
        text = text.replace("CARDNAME", name).replace("NICKNAME", Lang.getInstance().getNickName(name)).trim();
        for (String n : found) {
            // the expression itself (it has a $), so calculateAmount doesn't look the name up on the wrong object
            out.add(new Ref(trait, text, n, trait.getSVar(n)));
        }
    }

    /** The live SVars these params reference, following Execute$/SubAbility$ and the like into the abilities they name. */
    private static void scan(CardTraitBase trait, Map<String, String> params, Set<String> found, Set<String> visited) {
        // "any number of": its Amount is the most you could pick, not something the card counts
        boolean upTo = params.containsKey("AnyNumber") || params.values().stream().anyMatch(v -> v.toLowerCase().contains("any number"));
        for (Map.Entry<String, String> e : params.entrySet()) {
            String key = e.getKey();
            if (key.endsWith("Description") || key.startsWith("AI") || key.startsWith("Target") || key.equals("Max") || key.equals("Min")
                    || upTo && (key.equals("Amount") || key.equals("ChangeNum"))) {
                continue;
            }
            Matcher m = WORD.matcher(e.getValue());
            while (m.find()) {
                String name = m.group();
                // AffectedX is worked out per card a static affects, not for the card itself
                if (name.startsWith("Affected") || !trait.hasSVar(name) || !visited.add(name)) {
                    continue;
                }
                String value = trait.getSVar(name).trim();
                if (ABILITY.matcher(value).find()) {
                    scan(trait, parse(value), found, visited);
                } else if (live(trait, value, new HashSet<>(Set.of(name)))) {
                    found.add(name);
                }
            }
        }
    }

    private static boolean live(CardTraitBase trait, String value, Set<String> visited) {
        if (!LIVE.matcher(value).find() || BOUND.matcher(value).find() || CONDITIONAL.matcher(value).find()) {
            return false;
        }
        // SVar$Y and math like /Plus.Z name other SVars, which must be live too
        Matcher m = NAMED.matcher(value);
        while (m.find()) {
            String n = m.group(1);
            if (trait.hasSVar(n) && visited.add(n) && !live(trait, trait.getSVar(n).trim(), visited)) {
                return false;
            }
        }
        return true;
    }

    private static Map<String, String> parse(String ability) {
        Map<String, String> params = new HashMap<>();
        for (String part : ability.split("\\|")) {
            int i = part.indexOf('$');
            if (i > 0) {
                params.put(part.substring(0, i).trim(), part.substring(i + 1).trim());
            }
        }
        return params;
    }
}
