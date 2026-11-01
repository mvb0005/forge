package forge.web;

import com.google.common.collect.Multiset;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import forge.card.CardType;
import forge.card.ColorSet;
import forge.card.MagicColor;
import forge.card.mana.ManaAtom;
import forge.card.mana.ManaCost;
import forge.game.GameEntityView;
import forge.game.GameLogEntry;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.card.CardView.CardStateView;
import forge.game.card.CounterEnumType;
import forge.game.card.CounterType;
import forge.game.combat.CombatView;
import forge.game.keyword.Keyword;
import forge.game.keyword.KeywordView;
import forge.game.player.PlayerView;
import forge.game.spellability.StackItemView;
import forge.game.zone.ZoneType;
import forge.util.collect.FCollection;
import forge.util.collect.FCollectionView;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;

/** Turns Forge's view objects into the DTOs of PROTOCOL.md. Pure functions of the views plus what the local seat may see. */
final class ViewProjector {
    static final int LOG_LIMIT = 200;

    private static final Keyword[] BADGES = {
            Keyword.FLYING, Keyword.REACH, Keyword.DEATHTOUCH, Keyword.TRAMPLE, Keyword.LIFELINK, Keyword.FIRST_STRIKE,
            Keyword.DOUBLE_STRIKE, Keyword.VIGILANCE, Keyword.MENACE, Keyword.HASTE, Keyword.HEXPROOF,
            Keyword.INDESTRUCTIBLE, Keyword.INFECT, Keyword.DEFENDER, Keyword.SHROUD, Keyword.PROTECTION,
    };
    private static final CardType.CoreType[] CORE_TYPES = {
            CardType.CoreType.Creature, CardType.CoreType.Land, CardType.CoreType.Artifact, CardType.CoreType.Enchantment,
            CardType.CoreType.Planeswalker, CardType.CoreType.Battle, CardType.CoreType.Instant, CardType.CoreType.Sorcery,
            CardType.CoreType.Kindred,
    };
    static final ZoneType[] PLAYER_ZONES = {ZoneType.Hand, ZoneType.Battlefield, ZoneType.Graveyard, ZoneType.Exile, ZoneType.Command};

    private final WebGuiGame gui;

    ViewProjector(WebGuiGame gui) {
        this.gui = gui;
    }

    static String imgUrl(String key) {
        if (key == null || key.isEmpty()) {
            return null;
        }
        // Relative, so the same payload works at / and at /play/.
        return "img/card/" + URLEncoder.encode(key, StandardCharsets.UTF_8).replace("+", "%20");
    }

    static JsonElement ref(Object o) {
        if (o instanceof CardView cv) {
            return ref("card", cv.getId());
        }
        if (o instanceof PlayerView pv) {
            return ref("player", pv.getId());
        }
        return JsonNull.INSTANCE;
    }

    static JsonObject ref(String kind, int id) {
        JsonObject r = new JsonObject();
        r.addProperty("kind", kind);
        r.addProperty("id", id);
        return r;
    }

    static JsonElement id(Object o) {
        if (o instanceof CardView cv) {
            return new com.google.gson.JsonPrimitive(cv.getId());
        }
        if (o instanceof PlayerView pv) {
            return new com.google.gson.JsonPrimitive(pv.getId());
        }
        return JsonNull.INSTANCE;
    }

    static String colors(ColorSet cs) {
        if (cs == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(5);
        if (cs.hasAnyColor(MagicColor.WHITE)) { sb.append('W'); }
        if (cs.hasAnyColor(MagicColor.BLUE)) { sb.append('U'); }
        if (cs.hasAnyColor(MagicColor.BLACK)) { sb.append('B'); }
        if (cs.hasAnyColor(MagicColor.RED)) { sb.append('R'); }
        if (cs.hasAnyColor(MagicColor.GREEN)) { sb.append('G'); }
        return sb.toString();
    }

    static String zoneName(ZoneType z) {
        if (z == null) {
            return "other";
        }
        return switch (z) {
            case Hand -> "hand";
            case Library -> "library";
            case Battlefield -> "battlefield";
            case Graveyard -> "graveyard";
            case Exile -> "exile";
            case Command -> "command";
            case Stack -> "stack";
            default -> "other";
        };
    }

    private static JsonArray ids(Iterable<CardView> cards) {
        JsonArray a = new JsonArray();
        if (cards != null) {
            for (CardView c : cards) {
                if (c != null) {
                    a.add(c.getId());
                }
            }
        }
        return a;
    }

    private static JsonObject counters(Multiset<CounterType> counters, boolean skipPoison) {
        JsonObject o = new JsonObject();
        if (counters != null) {
            for (Multiset.Entry<CounterType> e : counters.entrySet()) {
                if (e.getCount() <= 0 || (skipPoison && e.getElement().is(CounterEnumType.POISON))) {
                    continue;
                }
                o.addProperty(e.getElement().getName().toLowerCase(), e.getCount());
            }
        }
        return o;
    }

    private static Integer parseInt(String s) {
        if (s == null || s.isEmpty()) {
            return null;
        }
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    JsonObject game(GameView gv) {
        JsonObject o = new JsonObject();
        o.addProperty("turn", gv.getTurn());
        o.addProperty("phase", gv.getPhase() == null ? null : gv.getPhase().name());
        o.add("activePlayerId", id(gv.getPlayerTurn()));
        JsonElement prio = JsonNull.INSTANCE;
        for (PlayerView p : gv.getPlayers()) {
            if (p.getHasPriority()) {
                prio = id(p);
            }
        }
        o.add("priorityPlayerId", prio);
        JsonArray local = new JsonArray();
        for (PlayerView p : gui.getLocalPlayers()) {
            local.add(p.getId());
        }
        o.add("localPlayerIds", local);
        List<Integer> order = gui.facts().turnOrder();
        if (!order.isEmpty()) {
            JsonArray a = new JsonArray();
            order.forEach(a::add);
            o.add("turnOrder", a);
        }
        o.addProperty("gameOver", gv.isGameOver());
        o.addProperty("winner", gv.isGameOver() ? gv.getWinningPlayerName() : null);
        return o;
    }

    static JsonObject logEntry(GameLogEntry e) {
        JsonObject le = new JsonObject();
        le.addProperty("type", e.type().name());
        le.addProperty("message", e.message());
        return le;
    }

    JsonObject player(PlayerView p) {
        JsonObject o = new JsonObject();
        o.addProperty("id", p.getId());
        o.addProperty("name", p.getName());
        o.addProperty("isAI", p.isAI());
        o.addProperty("life", p.getLife());
        o.addProperty("poison", p.getCounters() == null ? 0 : p.getCounters(CounterEnumType.POISON));
        o.add("counters", counters(p.getCounters(), true));
        JsonObject mana = new JsonObject();
        mana.addProperty("W", p.getMana((byte) ManaAtom.WHITE));
        mana.addProperty("U", p.getMana((byte) ManaAtom.BLUE));
        mana.addProperty("B", p.getMana((byte) ManaAtom.BLACK));
        mana.addProperty("R", p.getMana((byte) ManaAtom.RED));
        mana.addProperty("G", p.getMana((byte) ManaAtom.GREEN));
        mana.addProperty("C", p.getMana((byte) ManaAtom.COLORLESS));
        o.add("mana", mana);
        o.addProperty("handCount", p.getZoneSize(ZoneType.Hand));
        o.addProperty("libraryCount", p.getZoneSize(ZoneType.Library));
        JsonObject zones = new JsonObject();
        zones.add("hand", ids(p.getCards(ZoneType.Hand)));
        zones.add("battlefield", ids(p.getCards(ZoneType.Battlefield)));
        zones.add("graveyard", ids(p.getCards(ZoneType.Graveyard)));
        zones.add("exile", ids(p.getCards(ZoneType.Exile)));
        zones.add("command", ids(p.getCards(ZoneType.Command)));
        o.add("zones", zones);
        String[] face = gui.face(p.getName());
        o.addProperty("avatarImg", face != null && face[0] != null ? face[0] : imgUrl(p.getAvatarCardImageKey()));
        if (face != null && face[1] != null) {
            o.addProperty("discordId", face[1]);
        }
        o.addProperty("hasLost", p.getHasLost());
        String identity = gui.facts().colorIdentity(p.getId());
        if (identity != null) {
            JsonArray a = new JsonArray();
            for (char ch : identity.toCharArray()) {
                a.add(String.valueOf(ch));
            }
            o.add("colorIdentity", a);
        }
        List<CardView> own = p.getCommanders();
        if (own != null && !own.isEmpty()) {
            JsonArray a = new JsonArray();
            for (CardView c : own) {
                JsonObject e = new JsonObject();
                e.addProperty("cardId", c.getId());
                e.addProperty("casts", p.getCommanderCast(c));
                e.addProperty("tax", 2 * p.getCommanderCast(c));
                a.add(e);
            }
            o.add("commanders", a);
        }
        JsonArray dealt = new JsonArray();
        List<PlayerView> sources = new ArrayList<>();
        sources.add(p);
        sources.addAll(p.getOpponents());
        for (PlayerView q : sources) {
            if (q.getCommanders() == null) {
                continue;
            }
            for (CardView c : q.getCommanders()) {
                int d = p.getCommanderDamage(c);
                if (d > 0) {
                    JsonObject e = new JsonObject();
                    e.addProperty("cardId", c.getId());
                    e.addProperty("damage", d);
                    dealt.add(e);
                }
            }
        }
        if (!dealt.isEmpty()) {
            o.add("commanderDamage", dealt);
        }
        return o;
    }

    JsonObject card(CardView c) {
        Set<PlayerView> viewers = gui.getLocalPlayers();
        boolean visible = gui.mayView(c);
        JsonObject o = new JsonObject();
        o.addProperty("id", c.getId());
        o.addProperty("zone", zoneName(c.getZone()));
        o.add("ownerId", id(c.getOwner()));
        o.add("controllerId", id(c.getController()));
        o.addProperty("hidden", !visible);
        CardStateView state = visible ? c.getCurrentState() : null;
        o.addProperty("name", state == null ? "" : state.getName());
        String img = null;
        String backImg = null;
        if (state != null) {
            img = imgUrl(state.getImageKey(viewers));
            if (c.hasAlternateState() && gui.mayFlip(c)) {
                CardStateView alt = c.getAlternateState();
                if (alt != null) {
                    backImg = imgUrl(alt.getImageKey(viewers));
                }
            }
        }
        o.addProperty("img", img);
        o.addProperty("backImg", backImg);
        ManaCost cost = state == null ? null : state.getManaCost();
        o.addProperty("manaCost", cost == null || cost.isNoCost() ? "" : cost.toString());
        o.addProperty("colors", state == null ? "" : colors(state.getColors()));
        String typeLine = "";
        JsonArray types = new JsonArray();
        if (state != null && state.getType() != null) {
            typeLine = state.getType().toString().replace(" - ", " — ");
            Collection<CardType.CoreType> core = state.getType().getCoreTypes();
            for (CardType.CoreType ct : CORE_TYPES) {
                if (core.contains(ct)) {
                    types.add(ct.name());
                }
            }
        }
        o.addProperty("typeLine", typeLine);
        o.add("types", types);
        String text = "";
        if (state != null) {
            try {
                text = c.getText(state, null);
            } catch (Exception e) {
                text = state.getOracleText();
            }
        }
        o.addProperty("text", text == null ? "" : text);
        boolean creature = state != null && state.isCreature();
        o.addProperty("power", creature ? state.getPower() : null);
        o.addProperty("toughness", creature ? state.getToughness() : null);
        int[] base = creature && c.getZone() == ZoneType.Battlefield ? gui.facts().basePT(c.getId()) : null;
        if (base != null && (base[0] != state.getPower() || base[1] != state.getToughness())) {
            o.addProperty("basePower", base[0]);
            o.addProperty("baseToughness", base[1]);
        }
        o.addProperty("loyalty", state != null && state.isPlaneswalker() ? parseInt(state.getLoyalty()) : null);
        o.addProperty("defense", state != null && state.isBattle() ? parseInt(state.getDefense()) : null);
        o.addProperty("damage", visible ? c.getDamage() : 0);
        o.add("counters", visible ? counters(c.getCounters(), false) : new JsonObject());
        JsonArray kw = new JsonArray();
        JsonObject labels = new JsonObject();
        if (state != null && state.getKeywords() != null) {
            for (Keyword k : BADGES) {
                if (state.hasKeyword(k)) {
                    String key = k == Keyword.FIRST_STRIKE ? "first strike" : k == Keyword.DOUBLE_STRIKE ? "double strike" : k.name().toLowerCase();
                    kw.add(key);
                    labels(state, k, key, labels);
                }
            }
            if (state.hasWard()) {
                kw.add("ward");
                labels(state, Keyword.WARD, "ward", labels);
            }
            if (creature && c.getZone() == ZoneType.Battlefield && gui.facts().unblockable(c.getId())) {
                kw.add("can't be blocked");
            }
        }
        o.add("keywords", kw);
        if (labels.size() > 0) {
            o.add("keywordLabels", labels);
        }
        o.addProperty("tapped", c.isTapped());
        o.addProperty("sick", visible && c.isSick());
        o.addProperty("phasedOut", c.isPhasedOut());
        o.addProperty("faceDown", c.isFaceDown());
        o.addProperty("token", visible && c.isToken());
        CardView attachedTo = c.getAttachedTo();
        o.add("attachedToId", id(attachedTo));
        o.add("attachedToPlayerId", id(c.getEnchantedPlayer()));
        o.add("attachmentIds", ids(c.getAllAttachedCards()));
        o.add("exiledWithId", visible ? id(c.getExiledWith()) : JsonNull.INSTANCE);
        o.add("heldExileIds", visible ? ids(c.getExiledCards()) : new JsonArray());
        o.addProperty("commander", visible && c.isCommander());
        int sprocket = visible ? c.getSprocket() : 0;
        o.addProperty("sprocket", sprocket > 0 ? sprocket : null);
        return o;
    }

    /** The keyword's full titles ("Ward {2}", "Protection from red") when they say more than the key. */
    private static void labels(CardStateView state, Keyword k, String key, JsonObject out) {
        JsonArray a = new JsonArray();
        for (KeywordView v : state.getKeywords().getValues(k)) {
            String title = v.title() == null ? null : v.title().replace("from from ", "from "); // "Protection from black" titles twice
            if (title != null && !title.equalsIgnoreCase(key) && !a.contains(new com.google.gson.JsonPrimitive(title))) {
                a.add(title);
            }
        }
        if (!a.isEmpty()) {
            out.add(key, a);
        }
    }

    JsonArray stack(GameView gv) {
        JsonArray a = new JsonArray();
        FCollectionView<StackItemView> stack = gv.getStack();
        if (stack == null) {
            return a;
        }
        for (StackItemView si : stack) {
            JsonObject o = new JsonObject();
            o.addProperty("id", si.getId());
            o.add("sourceCardId", id(si.getSourceCard()));
            o.add("activatorId", id(si.getActivatingPlayer()));
            o.addProperty("text", si.getText());
            o.addProperty("isAbility", si.isAbility());
            o.addProperty("isTrigger", si.isTrigger());
            JsonArray targets = new JsonArray();
            if (si.getTargetCards() != null) {
                for (CardView c : si.getTargetCards()) {
                    targets.add(ref(c));
                }
            }
            if (si.getTargetPlayers() != null) {
                for (PlayerView p : si.getTargetPlayers()) {
                    targets.add(ref(p));
                }
            }
            o.add("targets", targets);
            a.add(o);
        }
        return a;
    }

    /** Cards the stack refers to (spells, sources and targets), so their ids are always known. */
    static void stackCards(GameView gv, Collection<CardView> out) {
        FCollectionView<StackItemView> stack = gv.getStack();
        if (stack == null) {
            return;
        }
        for (StackItemView si : stack) {
            if (si.getSourceCard() != null) {
                out.add(si.getSourceCard());
            }
            if (si.getTargetCards() != null) {
                for (CardView c : si.getTargetCards()) {
                    out.add(c);
                }
            }
        }
    }

    JsonElement combat(GameView gv) {
        CombatView cv = gv.getCombat();
        if (cv == null) {
            return JsonNull.INSTANCE;
        }
        JsonArray bands = new JsonArray();
        List<GameEntityView> defenders = new ArrayList<>();
        for (GameEntityView d : cv.getDefenders()) {
            defenders.add(d);
        }
        defenders.sort((a, b) -> Integer.compare(a.getId(), b.getId()));
        for (GameEntityView d : defenders) {
            List<FCollection<CardView>> list = new ArrayList<>();
            for (FCollection<CardView> band : cv.getAttackingBandsOf(d)) {
                list.add(band);
            }
            list.sort((a, b) -> Integer.compare(a.isEmpty() ? 0 : a.get(0).getId(), b.isEmpty() ? 0 : b.get(0).getId()));
            for (FCollection<CardView> band : list) {
                JsonObject o = new JsonObject();
                o.add("attackerIds", ids(band));
                o.add("defender", ref(d));
                o.add("blockerIds", ids(cv.getBlockers(band)));
                o.add("plannedBlockerIds", ids(cv.getPlannedBlockers(band)));
                bands.add(o);
            }
        }
        JsonObject o = new JsonObject();
        o.add("bands", bands);
        return o;
    }
}
