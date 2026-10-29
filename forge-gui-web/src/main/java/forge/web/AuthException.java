package forge.web;

/** A websocket or /api/games request had no acceptable Cloudflare Access identity. */
final class AuthException extends RuntimeException {
    AuthException(String message) {
        super(message);
    }
}
