package forge.web;

import com.google.gson.JsonObject;

/**
 * Outbound half of one browser connection. Implementations must be thread-safe and keep
 * messages in the order send() was called; they're sent from the game thread, the AI
 * threads and WebEdt alike.
 */
public interface ClientChannel {
    void send(JsonObject message);

    /** Close the socket with a private-use status. 4000 is "seat taken"; 4001 is "this socket was replaced". */
    void close(int code, String reason);
}
