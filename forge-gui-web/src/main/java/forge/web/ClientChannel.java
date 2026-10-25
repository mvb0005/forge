package forge.web;

import com.google.gson.JsonObject;

/**
 * Outbound half of one browser connection. Implementations must be thread-safe and keep
 * messages in the order send() was called; they're sent from the game thread, the AI
 * threads and WebEdt alike.
 */
public interface ClientChannel {
    void send(JsonObject message);
}
