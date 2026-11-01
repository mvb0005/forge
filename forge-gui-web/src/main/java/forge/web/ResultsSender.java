package forge.web;

import com.google.gson.JsonObject;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Posts a finished match's result, and each seat's replay, to the URLs its spec named (the tracker), with the
 * control secret, so the tracker can tell they came from here. Retries a few times; GET /match keeps the result too, so a result that
 * never arrives can still be read until the next match starts. The tracker treats it as idempotent by matchId.
 */
final class ResultsSender {
    private static final int ATTEMPTS = 5;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final String secret;

    ResultsSender(String secret) {
        this.secret = secret;
    }

    void send(String url, JsonObject result) {
        send(url, result.toString().getBytes(StandardCharsets.UTF_8), "application/json");
    }

    void send(String url, byte[] body, String contentType) {
        Thread t = new Thread(() -> post(url, body, contentType), "results");
        t.setDaemon(true);
        t.start();
    }

    private void post(String url, byte[] body, String contentType) {
        for (int i = 0; i < ATTEMPTS; i++) {
            try {
                HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(url))
                        .timeout(Duration.ofSeconds(30))
                        .header("Content-Type", contentType)
                        .POST(HttpRequest.BodyPublishers.ofByteArray(body));
                if (secret != null) {
                    req.header("Authorization", "Bearer " + secret);
                }
                int status = http.send(req.build(), HttpResponse.BodyHandlers.discarding()).statusCode();
                if (status / 100 == 2) {
                    return;
                }
                System.err.println("POST " + url + ": HTTP " + status);
            } catch (Exception e) {
                System.err.println("POST " + url + ": " + e);
            }
            try {
                Thread.sleep(2000L << i);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        System.err.println("Gave up sending to " + url);
    }
}
