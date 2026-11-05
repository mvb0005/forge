package forge.web;

import com.google.gson.JsonObject;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.card.CardView.CardStateView;
import forge.game.player.PlayerView;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The cards of a match's replay (docs/REPLAYS.md D-R6). Each card is drawn as it is for everyone who may see it
 * (the seats together), and carries {@code "as":{"<seat>":<card>}} for each seat that sees it otherwise: another
 * player's hand, a face-down card's front, a library card one seat is looking at. Every version is made by
 * {@link ViewProjector#card} with that seat as the viewer, so the engine decides what each seat saw.
 */
final class TableView {
    private final ViewProjector proj;
    private final List<String> seatNames;
    private final PlayerView[] bySeat;
    private final Set<PlayerView> all = new LinkedHashSet<>();

    TableView(ViewProjector proj, List<String> seatNames) {
        this.proj = proj;
        this.seatNames = List.copyOf(seatNames);
        this.bySeat = new PlayerView[seatNames.size()];
    }

    /** Seats are matched to players by name (unique in a match). A player who has left keeps their seat. */
    private void seat(GameView gv) {
        for (PlayerView p : gv.getPlayers()) {
            int i = seatNames.indexOf(p.getName());
            if (i >= 0 && bySeat[i] == null) {
                bySeat[i] = p;
                all.add(p);
            }
        }
    }

    JsonObject card(CardView c, GameView gv) {
        seat(gv);
        boolean visible = c.canBeShownToAny(all);
        boolean flip = mayFlip(c, all);
        JsonObject o = proj.card(c, all, visible, flip);
        JsonObject as = null;
        String base = null;
        for (int i = 0; i < bySeat.length; i++) {
            PlayerView p = bySeat[i];
            if (p == null) {
                continue;
            }
            Set<PlayerView> one = Set.of(p);
            boolean v = c.canBeShownTo(p);
            boolean f = mayFlip(c, one);
            if (v == visible && f == flip) {
                continue; // what a card shows depends on its viewers only through these two
            }
            JsonObject mine = proj.card(c, one, v, f);
            if (base == null) {
                base = o.toString();
            }
            if (!mine.toString().equals(base)) {
                if (as == null) {
                    as = new JsonObject();
                }
                as.add(String.valueOf(i), mine);
            }
        }
        if (as != null) {
            o.add("as", as);
        }
        return o;
    }

    /** AbstractGuiGame.mayFlip for these viewers. */
    static boolean mayFlip(CardView c, Set<PlayerView> viewers) {
        CardStateView alt = c.getAlternateState();
        if (alt == null) {
            return false;
        }
        return switch (alt.getState()) {
            case Original -> !c.isFaceDown() || c.canFaceDownBeShownToAny(viewers);
            case Flipped, Meld, Backside -> true;
            case Secondary -> c.isFaceDown() && c.canFaceDownBeShownToAny(viewers);
            case PreparedSpell -> c.isFaceDown() ? c.canFaceDownBeShownToAny(viewers) : c.useCardArt();
            default -> false;
        };
    }
}
