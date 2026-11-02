package forge.web;

import java.util.List;

/**
 * Curated Bracket 2 Commander precons: each plays one recognisable plan, paired with the AI profile
 * (res/ai) that leans the same way. Reckless attacks into trades, Cautious holds back and counters,
 * Experimental takes more chances with its spells.
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
                    "Hands out cards and mana: a slow, friendly table.", "Peace Offering [BLC] [2024]", "Cautious"),
            new Opponent("hakbal", "Hakbal of the Surging Soul", "Merfolk counters",
                    "Explores across a merfolk army to grow the board and draw lands.", "Explorers of the Deep [LCC] [2023]", "Default"),
            new Opponent("bello", "Bello, Bard of the Brambles", "Animated artifacts",
                    "Turns big artifacts and enchantments into hasty 4/4 indestructible attackers.", "Animated Army [BLC] [2024]", "Reckless"),
            new Opponent("hazel", "Hazel of the Rootbloom", "Squirrel tokens",
                    "Taps tokens for mana, copies them at end step, and drains the table.", "Squirreled Away [BLC] [2024]", "Default"),
            new Opponent("zinnia", "Zinnia, Valley's Voice", "Offspring tokens",
                    "Pays extra for 1/1 token copies of every creature with strong ETB triggers.", "Family Matters [BLC] [2024]", "Default"),
            new Opponent("stella", "Stella Lee, Wild Card", "Spellslinger combo",
                    "Casts multiple spells a turn to impulse draw and copy big instants.", "Quick Draw [OTC] [2024]", "Experimental"),
            new Opponent("gonti", "Gonti, Canny Acquisitor", "Theft & evasive",
                    "Hits players with unblockable rogues to exile and cast cards from their decks.", "Grand Larceny [OTC] [2024]", "Default"),
            new Opponent("olivia", "Olivia, Opulent Outlaw", "Outlaw treasure",
                    "Attacks with outlaws to amass Treasure and pump the team.", "Most Wanted [OTC] [2024]", "Reckless"),
            new Opponent("yuma", "Yuma, Proud Protector", "Lands & deserts",
                    "Sacrifices and recurs Deserts to make an army of 4/2 plant warriors.", "Desert Bloom [OTC] [2024]", "Default"),
            new Opponent("mothman", "The Wise Mothman", "Rad counters",
                    "Hands out rad counters that mill everyone and put +1/+1 counters on fliers.", "Mutant Menace [PIP] [2024]", "Default"),
            new Opponent("caesar", "Caesar, Legion's Emperor", "Token sacrifice",
                    "Sacrifices a token on attack to make soldiers, draw cards, and burn an opponent.", "Hail, Caesar [PIP] [2024]", "Reckless"),
            new Opponent("dogmeat", "Dogmeat, Ever Loyal", "Junk Voltron",
                    "Mills for auras and equipment, makes Junk tokens, and swings suited up.", "Scrappy Survivors [PIP] [2024]", "Reckless"),
            new Opponent("madison", "Dr. Madison Li", "Artifact energy",
                    "Casts artifacts to build energy, then spends it to draw or reanimate machines.", "Science! [PIP] [2024]", "Experimental"),
            new Opponent("nelly", "Nelly Borca, Impulsive Accuser", "Goad politics",
                    "Suspects and goads creatures so opponents have to attack each other.", "Blame Game [MKC] [2024]", "Cautious"),
            new Opponent("morska", "Morska, Undersea Sleuth", "Clue midrange",
                    "Makes a Clue every turn and grows huge as you crack tokens and draw cards.", "Deep Clue Sea [MKC] [2024]", "Default"),
            new Opponent("mirko", "Mirko, Obsessive Theorist", "Surveil reanimator",
                    "Surveils creatures into the graveyard, grows, and brings them back at end step.", "Revenant Recon [MKC] [2024]", "Default"),
            new Opponent("clavileno", "Clavileño, First of the Blessed", "Vampire aristocrats",
                    "Turns attacking vampires into demons that draw a card and make a 4/3 flier when they die.", "Blood Rites [LCC] [2023]", "Default"),
            new Opponent("brass", "Admiral Brass, Unsinkable", "Pirate reanimator",
                    "Mills and attacks with pirates, bringing them back as 4/4s with haste.", "Ahoy Mateys [LCC] [2023]", "Reckless"),
            new Opponent("ellivere", "Ellivere of the Wild Court", "Enchantress roles",
                    "Puts Virtuous Role auras on creatures so every attacker scales with your enchantments.", "Virtue and Valor [WOC] [2023]", "Reckless"),
            new Opponent("tegwyll", "Tegwyll, Duke of Splendor", "Faerie tribal",
                    "Flashes in faeries, buffs them in the air, and draws whenever one dies.", "Fae Dominion [WOC] [2023]", "Default"),
            new Opponent("sidar", "Sidar Jabari of Zhalfir", "Knight reanimator",
                    "Loots on every knight attack and reanimates a knight on combat damage.", "Cavalry Charge [MOC] [2023]", "Reckless"),
            new Opponent("ixhel", "Ixhel, Scion of Atraxa", "Toxic & poison",
                    "Spreads poison counters with toxic creatures and steals cards from poisoned players.", "Corrupting Influence [ONC] [2023]", "Default"),
            new Opponent("urza", "Urza, Chief Artificer", "Artifact constructs",
                    "Cheats out Urza with affinity and makes a massive Construct token every end step.", "Urza's Iron Alliance [BRC] [2022]", "Default"),
            new Opponent("mishra", "Mishra, Eminent One", "Artifact copies",
                    "Copies a noncreature artifact as a 4/4 hasty Warform every combat.", "Mishra's Burnished Banner [BRC] [2022]", "Experimental"),
            new Opponent("henzie", "Henzie \"Toolbox\" Torre", "Blitz stompy",
                    "Blitzes big creatures in cheap with haste, then draws a card when they die.", "Riveteer Rampage [NCC] [2022]", "Reckless"),
            new Opponent("kamiz", "Kamiz, Obscura Oculus", "Connive combat",
                    "Makes one attacker unblockable to connive and gives another double strike.", "Obscura Operation [NCC] [2022]", "Default"),
            new Opponent("prosper", "Prosper, Tome-Bound", "Impulse & treasure",
                    "Exiles a card every end step and makes a Treasure whenever you play from exile.", "Planar Portal [AFC] [2021]", "Experimental"),
            new Opponent("osgir", "Osgir, the Reconstructor", "Artifact recursion",
                    "Sacrifices artifacts and exiles them from the graveyard to make two token copies.", "Lorehold Legacies [C21] [2021]", "Default"),
            new Opponent("breena", "Breena, the Demagogue", "Political aggro",
                    "Rewards anyone who attacks the highest-life opponent with cards and +1/+1 counters.", "Silverquill Statement [C21] [2021]", "Cautious"),
            new Opponent("aesi", "Aesi, Tyrant of Gyre Strait", "Simic landfall",
                    "Plays extra lands, draws a card on every landfall, and floods the board with sea monsters.", "Reap the Tides [CMR] [2020]", "Default"),
            new Opponent("meren", "Meren of Clan Nel Toth", "Golgari recursion",
                    "Builds experience counters as creatures die and reanimates one every end step.", "Plunder the Graves [C15] [2015]", "Default"),
            new Opponent("edgar", "Edgar Markov", "Vampire swarm",
                    "Makes an extra vampire token on every vampire cast, even from the command zone.", "Vampiric Bloodlust [C17] [2017]", "Reckless"));

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
