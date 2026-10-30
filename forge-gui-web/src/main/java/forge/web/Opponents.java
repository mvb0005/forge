package forge.web;

import java.util.List;

/**
 * Curated Commander opponents for goldfishing: a precon that plays one recognisable plan, paired with the
 * AI profile (res/ai) that leans the same way. Reckless attacks into trades, Cautious holds back and
 * counters, Experimental takes more chances with its spells. To add one, add a row.
 */
final class Opponents {
    record Opponent(String id, String commander, String archetype, String plan, String precon, String profile) {}

    static final List<Opponent> ROSTER = List.of(
            new Opponent("neyali", "Neyali, Suns' Vanguard", "Go-wide aggro",
                    "Makes soldier tokens and attacks with everything, every turn.", "Rebellion Rising [ONC] [2023]", "Reckless"),
            new Opponent("pantlaza", "Pantlaza, Sun-Favored", "Big stompy",
                    "Ramps, then attacks with huge dinosaurs.", "Veloci-Ramp-Tor [LCC] [2023]", "Reckless"),
            new Opponent("galea", "Galea, Kindler of Hope", "Voltron",
                    "Suits up one creature with auras and equipment and goes for commander damage.", "Aura of Courage [AFC] [2021]", "Reckless"),
            new Opponent("lathril", "Lathril, Blade of the Elves", "Elf ramp",
                    "Floods the board with elves, then drains the table.", "Elven Empire [KHC] [2021]", "Default"),
            new Opponent("wilhelt", "Wilhelt, the Rotcleaver", "Aristocrats",
                    "Sacrifices zombies for value and drains you a little at a time.", "Undead Unleashed [MIC] [2021]", "Default"),
            new Opponent("valgavoth", "Valgavoth, Harrower of Souls", "Group slug",
                    "Punishes everyone each turn, so every life total drops.", "Endless Punishment [DSC] [2024]", "Default"),
            new Opponent("zaffai", "Zaffai, Thunder Conductor", "Spellslinger",
                    "Chains instants and sorceries into burn and tokens.", "Prismari Performance [C21] [2021]", "Experimental"),
            new Opponent("jeleva", "Jeleva, Nephalia's Scourge", "Control",
                    "Holds up answers, blocks well and attacks only when it's safe.", "Mind Seize [C13] [2013]", "Cautious"),
            new Opponent("bumbleflower", "Ms. Bumbleflower", "Group hug",
                    "Hands out cards and mana: a slow, friendly table.", "Peace Offering [BLC] [2024]", "Cautious"));

    static Opponent byId(String id) {
        for (Opponent o : ROSTER) {
            if (o.id().equals(id)) {
                return o;
            }
        }
        return null;
    }

    private Opponents() {}
}
