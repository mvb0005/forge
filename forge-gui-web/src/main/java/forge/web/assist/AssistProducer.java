package forge.web.assist;

import com.google.gson.JsonElement;
import forge.game.Game;
import forge.game.player.Player;

/**
 * One kind of engine-computed help for the UI (PROTOCOL.md, "assist"). Producers are registered in
 * one place and run on the game thread when the engine asks the human for input, never inside the
 * state flush, so they read a consistent game.
 */
public interface AssistProducer {
    /** The `kind` field of the assist message, e.g. "combat". */
    String kind();

    /**
     * The payload for `seat`, the human the UI belongs to. Returns null when there's nothing to say
     * (sent as `null`, which clears that kind on the client). Must only use what `seat` may know.
     */
    JsonElement compute(Game game, Player seat);
}
