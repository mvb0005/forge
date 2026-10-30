package forge.web;

import forge.deck.Deck;
import forge.deck.DeckRecognizer;
import forge.deck.DeckRecognizer.Token;
import forge.deck.DeckRecognizer.TokenType;
import forge.deck.DeckSection;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * A deck from mtg-tracker's decklist export ("Commander" and "Deck" sections, "1 Name (SET) 123 *F*"),
 * read with the recogniser the desktop deck import uses. A printing Forge doesn't know falls back to any
 * printing; a card it doesn't know at all refuses the deck, naming every such card.
 */
final class TrackerDeck {
    /** The "(SET) 123 *F*" tail, so a line can be retried by name alone. */
    private static final Pattern PRINTING = Pattern.compile("^(\\s*\\d+x?\\s+.+?)\\s+\\([A-Za-z0-9_]{2,7}\\)(?:\\s+[^\\s*]+)?(?:\\s+\\*[A-Z]\\*)?\\s*$");

    static Deck parse(String name, String text) {
        DeckRecognizer recognizer = new DeckRecognizer();
        recognizer.forceImportBannedAndRestrictedCards();
        String[] lines = text.replace("\r", "").split("\n");
        DeckSection section = null;
        for (int i = 0; i < lines.length; i++) {
            Token token = recognizer.recognizeLine(lines[i], section);
            if (token == null) {
                continue;
            }
            if (token.getType() == TokenType.DECK_SECTION_NAME) {
                section = DeckSection.valueOf(token.getText());
            } else if (!token.isCardToken()) {
                String byName = PRINTING.matcher(lines[i]).replaceFirst("$1");
                Token retry = byName.equals(lines[i]) ? null : recognizer.recognizeLine(byName, section);
                if (retry != null && retry.isCardToken()) {
                    lines[i] = byName;
                }
            }
        }
        Deck deck = new Deck(name);
        List<String> unknown = new ArrayList<>();
        for (Token token : recognizer.parseCardList(lines)) {
            TokenType type = token.getType();
            if (type == TokenType.UNKNOWN_CARD || type == TokenType.UNSUPPORTED_CARD) {
                unknown.add(PRINTING.matcher(token.getText()).replaceFirst("$1").replaceFirst("^\\s*\\d+x?\\s+", ""));
            } else if (token.isTokenForDeck() && type != TokenType.DECK_NAME) {
                deck.getOrCreate(token.getTokenSection()).add(token.getCard(), token.getQuantity());
            }
        }
        if (!unknown.isEmpty()) {
            throw new IllegalArgumentException("Forge doesn't know these cards yet: " + String.join(", ", unknown));
        }
        if (!deck.has(DeckSection.Commander) || deck.get(DeckSection.Commander).isEmpty()) {
            throw new IllegalArgumentException(name + " has no commander. Pick one on the tracker's deck page.");
        }
        return deck;
    }

    private TrackerDeck() {}
}
