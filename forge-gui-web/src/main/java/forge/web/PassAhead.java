package forge.web;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;

import com.google.common.eventbus.Subscribe;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.event.GameEventLandPlayed;
import forge.game.event.GameEventPlayerPriority;
import forge.game.event.GameEventTurnPhase;
import forge.game.player.Player;
import forge.game.spellability.SpellAbilityStackInstance;

/**
 * Passing ahead (M12.1). Priority goes around the table one player at a time; a seat waiting for its turn may pass
 * now, and its pass is used the moment priority reaches it. A pass counts only for the round it was given in: a round
 * is the stretch of passes with the game unchanged, and it ends when the step changes, the stack changes, or a player
 * who has priority does something and keeps it (a land, a special action: the engine asks them again). That is the
 * rule's "all players pass in succession without taking any actions" (117.4), so passing ahead never changes what
 * happens, only how long it takes. A pass that is used, or a round that ends by resolving, goes quietly; a pass
 * cancelled because someone acted is told to its seat, naming what they did. Passes are private to their seat.
 * Waiting doesn't run anyone's clock: the respond timer starts when priority reaches you, as before.
 */
final class PassAhead {
    private static final Map<Game, PassAhead> GAMES = Collections.synchronizedMap(new WeakHashMap<>());

    /** The game's coordinator, subscribed to its events the first time any seat asks. */
    static PassAhead of(Game game) {
        synchronized (GAMES) {
            PassAhead p = GAMES.get(game);
            if (p == null) {
                p = new PassAhead(game);
                GAMES.put(game, p);
                game.subscribeToEvents(p);
            }
            return p;
        }
    }

    /** The game is over: let its coordinator go (its seats hold the sessions). */
    static void forget(Game game) {
        GAMES.remove(game);
    }

    private final Game game;
    private final Map<Player, WebGuiGame> seats = new HashMap<>();
    private final Map<Player, Long> ahead = new HashMap<>(); // seat -> the round it passed ahead in
    private long round = 1;
    private Player first; // who had priority when this round began; it goes around from them
    private Player holder;
    private List<Integer> stack = List.of(); // stack item ids, top first
    private GameEventLandPlayed land; // the last land played, for saying why passes were cancelled

    private PassAhead(Game game) {
        this.game = game;
    }

    synchronized void seat(Player p, WebGuiGame session) {
        seats.put(p, session);
    }

    synchronized long round() {
        return round;
    }

    @Subscribe
    public void onPhase(GameEventTurnPhase e) {
        List<WebGuiGame> told;
        synchronized (this) {
            endRound(null, null);
            told = new ArrayList<>(seats.values());
        }
        told.forEach(WebGuiGame::sendAhead);
    }

    @Subscribe
    public void onLand(GameEventLandPlayed e) {
        synchronized (this) {
            land = e;
        }
    }

    @Subscribe
    public void onPriority(GameEventPlayerPriority e) {
        Player p = game.getPlayer(e.priority());
        List<SpellAbilityStackInstance> items = new ArrayList<>();
        game.getStack().forEach(items::add);
        List<Integer> now = items.stream().map(SpellAbilityStackInstance::getId).toList();
        List<WebGuiGame> told;
        synchronized (this) {
            if (!now.equals(stack)) {
                // Something new on top (a spell, an ability, a trigger) cancels; a resolve doesn't, everyone passed.
                boolean grew = now.size() > stack.size() && now.subList(now.size() - stack.size(), now.size()).equals(stack);
                endRound(grew ? what(items.get(0)) : null, grew ? items.get(0).getId() : null);
            } else if (p != null && p == holder) {
                // Asked again with nothing new on the stack: a land, a special action, or a cast they backed out of
                // (the engine can't tell us which). Ending the round is safe either way; say only what we know.
                GameEventLandPlayed l = land;
                boolean theirLand = l != null && game.getPlayer(l.player()) == p;
                endRound(theirLand ? p.getName() + " played " + l.land().getName() : p.getName() + " kept priority", null);
            } else if (holder != null) {
                ahead.remove(holder); // they passed: theirs is used (or they passed by hand)
            }
            land = null;
            stack = now;
            if (first == null) {
                first = p;
            }
            holder = p;
            told = new ArrayList<>(seats.values());
        }
        told.forEach(WebGuiGame::sendAhead);
    }

    // this held
    private void endRound(String why, Integer stackId) {
        if (why != null) {
            for (Player seat : ahead.keySet()) {
                WebGuiGame s = seats.get(seat);
                if (s != null) {
                    s.aheadCancelled(why, stackId);
                }
            }
        }
        ahead.clear();
        round++;
        first = null;
        holder = null;
    }

    private static String what(SpellAbilityStackInstance si) {
        Card src = si.getSourceCard();
        String card = src == null ? "something" : src.getName();
        Player who = si.getActivatingPlayer();
        String name = who == null ? "Someone" : who.getName();
        if (si.isTrigger()) {
            return card + " triggered";
        }
        return si.isSpell() ? name + " cast " + card : name + " activated " + card;
    }

    /** Where a seat is in the round: may it pass ahead now, and has it. Only ever sent to that seat. */
    record State(long round, boolean open, boolean passed) {}

    synchronized State state(Player seat) {
        Long r = ahead.get(seat);
        return new State(round, open(seat), r != null && r == round);
    }

    // this held. Still to be asked this round, and would be asked (not passed for by its stops or its yield).
    private boolean open(Player seat) {
        if (seat == null || holder == null || first == null || seat == holder || seat.hasLost()) {
            return false;
        }
        WebGuiGame session = seats.get(seat);
        if (session == null || !session.wouldAsk(game, seat, stack.isEmpty())) {
            return false;
        }
        Player x = holder;
        for (int i = 0; i < game.getPlayers().size(); i++) {
            x = game.getNextPlayerAfter(x);
            if (x == null || x == first) {
                return false;
            }
            if (x == seat) {
                return true;
            }
        }
        return false;
    }

    /** The seat passes ahead for the round it saw. False when that round is over or it isn't still to be asked. */
    synchronized boolean pass(Player seat, long seen) {
        if (seen != round || !open(seat)) {
            return false;
        }
        ahead.put(seat, round);
        return true;
    }

    synchronized void unpass(Player seat) {
        ahead.remove(seat);
    }

    /** Priority has reached the seat: true if it passed ahead in this round (the pass is used). */
    synchronized boolean take(Player seat) {
        Long r = ahead.remove(seat);
        return r != null && r == round && seat == holder;
    }
}
