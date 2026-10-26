package forge.web;

import forge.card.ColorSet;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.staticability.StaticAbility;
import forge.game.staticability.StaticAbilityMode;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.web.assist.Samples;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Card and player facts the views don't carry, read from the game at decision points (by the thread that
 * owns the game) so the state flush can project them without touching the model. They lag the game
 * between decision points.
 */
final class BoardFacts {
    private static final ZoneType[] OWNED_ZONES = {ZoneType.Library, ZoneType.Hand, ZoneType.Battlefield, ZoneType.Graveyard,
            ZoneType.Exile, ZoneType.Command};

    private volatile Map<Integer, int[]> basePT = Map.of();
    private volatile Set<Integer> unblockable = Set.of();
    private volatile List<Integer> turnOrder = List.of();
    private final Map<Integer, String> colorIdentity = new ConcurrentHashMap<>();
    private final Samples times = new Samples();

    void update(Game game) {
        long t0 = System.nanoTime();
        List<StaticAbility> cantBlockBy = new ArrayList<>();
        for (Card c : game.getCardsWithStaticAbility(StaticAbilityMode.CantBlockBy)) {
            for (StaticAbility st : c.getStaticAbilities()) {
                // StaticAbilityCantAttackBlock.cantBlockBy(attacker, null) is always false (it needs a blocker for
                // ValidDefender), so "can't be blocked" is a CantBlockBy that names no blocker, defender or relation
                if (st.checkConditions(StaticAbilityMode.CantBlockBy) && !st.hasParam("ValidBlocker") && !st.hasParam("ValidDefender")
                        && !st.hasParam("ValidAttackerRelative") && !st.hasParam("ValidBlockerRelative")) {
                    cantBlockBy.add(st);
                }
            }
        }
        Map<Integer, int[]> pt = new ConcurrentHashMap<>();
        Set<Integer> unbl = ConcurrentHashMap.newKeySet();
        List<Integer> order = new ArrayList<>();
        for (Player p : game.getPlayersInTurnOrder()) {
            order.add(p.getId());
            if (colorIdentity.getOrDefault(p.getId(), "").isEmpty()) {
                // a saved board is applied after the first decision points, so keep trying while it comes out empty
                colorIdentity.put(p.getId(), identity(p));
            }
        }
        for (Card c : game.getCardsIn(ZoneType.Battlefield)) {
            if (!c.isCreature()) {
                continue;
            }
            pt.put(c.getId(), new int[] {c.getCurrentPower(), c.getCurrentToughness()});
            for (StaticAbility st : cantBlockBy) {
                if (st.matchesValidParam("ValidAttacker", c)) {
                    unbl.add(c.getId());
                    break;
                }
            }
        }
        basePT = pt;
        unblockable = unbl;
        turnOrder = List.copyOf(order);
        synchronized (times) {
            times.add(System.nanoTime() - t0);
        }
    }

    /** The commander's colour identity, else the deck's colours, else the colours of the cards the player owns. */
    private static String identity(Player p) {
        ColorSet id = p.getCommanderColorID();
        if (id != null) {
            return ViewProjector.colors(id);
        }
        int mask = 0;
        Deck deck = p.getRegisteredPlayer() == null ? null : p.getRegisteredPlayer().getDeck();
        if (deck != null) {
            for (Map.Entry<PaperCard, Integer> e : deck.getMain()) {
                mask |= e.getKey().getRules().getColor().getColor();
            }
        }
        if (mask == 0) {
            for (Card c : p.getCardsIn(OWNED_ZONES)) {
                if (c.getOwner() == p && !c.isToken()) {
                    mask |= c.getColor().getColor();
                }
            }
        }
        return ViewProjector.colors(ColorSet.fromMask(mask));
    }

    /** {power, toughness} before counters, pumps and anthems, for a creature on the battlefield; null if unknown. */
    int[] basePT(int cardId) {
        return basePT.get(cardId);
    }

    boolean unblockable(int cardId) {
        return unblockable.contains(cardId);
    }

    List<Integer> turnOrder() {
        return turnOrder;
    }

    /** "WU" style; null until the first decision point. */
    String colorIdentity(int playerId) {
        return colorIdentity.get(playerId);
    }

    String stats() {
        synchronized (times) {
            return times.summary();
        }
    }
}
