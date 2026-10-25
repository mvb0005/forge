package forge.web;

import com.google.gson.JsonObject;
import forge.gui.interfaces.IGuiGame;

/**
 * One local human seat in a running match, as seen by the server. WebServer/MatchHost own the
 * connection and lobby; the session owns everything game-scoped (state sync, prompts, asks).
 */
public interface WebGameSession {
    /** The IGuiGame to hand to HostedMatch for the human player. */
    IGuiGame gui();

    /** A game-scoped client message (see PROTOCOL.md "Client to server"). Called on WebEdt. */
    void onClientMessage(JsonObject message);

    /** The browser (re)connected: send a full state, then re-send the open prompt, buttons, selectables and ask. */
    void onConnect(ClientChannel channel);
}
