package forge.web;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * The same Cloudflare Access check the tracker uses: RS256, this team's issuer, this app's audience.
 * The email header is not trusted; only a verified token names the person.
 */
final class AccessIdentity {
    private final String issuer;
    private final String audience;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final Map<String, PublicKey> keys = new HashMap<>();
    private long fetchedAt;
    private long triedAt;

    private AccessIdentity(String issuer, String audience) {
        this.issuer = issuer;
        this.audience = audience;
    }

    /** Injected keys, for tests. Nothing is ever fetched. */
    AccessIdentity(String issuer, String audience, Map<String, PublicKey> keys) {
        this(issuer, audience);
        this.keys.putAll(keys);
        this.fetchedAt = Long.MAX_VALUE;
        this.triedAt = Long.MAX_VALUE;
    }

    /** Null when this process is local play and Access is not configured. */
    static AccessIdentity fromEnv() {
        String domain = System.getenv("CF_ACCESS_TEAM_DOMAIN");
        String aud = System.getenv("CF_ACCESS_AUD");
        if (domain == null || domain.isBlank() || aud == null || aud.isBlank()) {
            return null;
        }
        domain = domain.trim();
        if (domain.startsWith("https://")) {
            domain = domain.substring("https://".length());
        }
        int slash = domain.indexOf('/');
        if (slash >= 0) {
            domain = domain.substring(0, slash);
        }
        return new AccessIdentity("https://" + domain, aud.trim());
    }

    /** The Access JWT from the assertion header, or the CF_Authorization cookie. */
    static String tokenFrom(String assertion, String cookieHeader) {
        if (assertion != null && !assertion.isBlank()) {
            return assertion.trim();
        }
        if (cookieHeader == null) {
            return null;
        }
        for (String part : cookieHeader.split(";")) {
            String p = part.trim();
            int eq = p.indexOf('=');
            if (eq > 0 && "CF_Authorization".equals(p.substring(0, eq).trim())) {
                String value = p.substring(eq + 1).trim();
                return value.isEmpty() ? null : value;
            }
        }
        return null;
    }

    /** Verified email, lower-cased. Throws when the token is missing or not this app's. */
    String email(String jwt) {
        if (jwt == null || jwt.isBlank()) {
            throw new AuthException("missing token");
        }
        String[] parts = jwt.split("\\.");
        if (parts.length != 3) {
            throw new AuthException("malformed token");
        }
        JsonObject header = json(parts[0]);
        if (!"RS256".equals(text(header, "alg"))) {
            throw new AuthException("unsupported algorithm");
        }
        String kid = text(header, "kid");
        if (kid == null) {
            throw new AuthException("missing key id");
        }
        if (!verify(parts[0] + "." + parts[1], parts[2], key(kid))) {
            throw new AuthException("bad signature");
        }
        JsonObject claims = json(parts[1]);
        if (!issuer.equals(text(claims, "iss"))) {
            throw new AuthException("wrong issuer");
        }
        if (!audience(claims)) {
            throw new AuthException("wrong audience");
        }
        long now = Instant.now().getEpochSecond();
        if (!claims.has("exp") || claims.get("exp").getAsLong() + 60 < now) {
            throw new AuthException("expired");
        }
        if (claims.has("nbf") && claims.get("nbf").getAsLong() > now + 60) {
            throw new AuthException("not yet valid");
        }
        String email = text(claims, "email");
        if (email == null || !email.contains("@")) {
            throw new AuthException("token is not a person");
        }
        return email.trim().toLowerCase();
    }

    /** Board name for an email: the mailbox, without characters a player name cannot carry. */
    static String displayName(String email) {
        int at = email.indexOf('@');
        String local = at > 0 ? email.substring(0, at) : email;
        local = local.replaceAll("[^\\p{L}\\p{N} ._'\\-]", "").trim();
        if (local.isEmpty()) {
            return "Player";
        }
        return local.length() > 32 ? local.substring(0, 32) : local;
    }

    private boolean audience(JsonObject claims) {
        if (!claims.has("aud")) {
            return false;
        }
        JsonElement aud = claims.get("aud");
        if (aud.isJsonPrimitive()) {
            return audience.equals(aud.getAsString());
        }
        if (aud.isJsonArray()) {
            for (JsonElement e : aud.getAsJsonArray()) {
                if (e.isJsonPrimitive() && audience.equals(e.getAsString())) {
                    return true;
                }
            }
        }
        return false;
    }

    private PublicKey key(String kid) {
        synchronized (keys) {
            PublicKey found = keys.get(kid);
            long now = System.currentTimeMillis();
            if (found != null && now - fetchedAt < 3_600_000L) {
                return found;
            }
            // Anyone can send a token with a made-up key id, so fetch at most once a minute.
            if (now - triedAt < 60_000L) {
                if (found == null) {
                    throw new AuthException("unknown key");
                }
                return found;
            }
            triedAt = now;
            fetch();
            found = keys.get(kid);
            if (found == null) {
                throw new AuthException("unknown key");
            }
            return found;
        }
    }

    private void fetch() {
        HttpRequest req = HttpRequest.newBuilder(URI.create(issuer + "/cdn-cgi/access/certs"))
                .timeout(Duration.ofSeconds(5)).GET().build();
        HttpResponse<String> res;
        try {
            res = http.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new AuthException("could not fetch access keys");
        }
        if (res.statusCode() != 200) {
            throw new AuthException("could not fetch access keys");
        }
        JsonObject body = JsonParser.parseString(res.body()).getAsJsonObject();
        Map<String, PublicKey> next = new HashMap<>();
        for (JsonElement el : body.getAsJsonArray("keys")) {
            JsonObject jwk = el.getAsJsonObject();
            if (!"RSA".equals(text(jwk, "kty"))) {
                continue;
            }
            String kid = text(jwk, "kid");
            String n = text(jwk, "n");
            String e = text(jwk, "e");
            if (kid == null || n == null || e == null) {
                continue;
            }
            next.put(kid, rsa(n, e));
        }
        keys.clear();
        keys.putAll(next);
        fetchedAt = System.currentTimeMillis();
    }

    private static boolean verify(String signingInput, String signature, PublicKey key) {
        try {
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(key);
            sig.update(signingInput.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return sig.verify(Base64.getUrlDecoder().decode(signature));
        } catch (Exception e) {
            return false;
        }
    }

    private static PublicKey rsa(String n, String e) {
        try {
            BigInteger mod = new BigInteger(1, Base64.getUrlDecoder().decode(n));
            BigInteger exp = new BigInteger(1, Base64.getUrlDecoder().decode(e));
            return KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(mod, exp));
        } catch (Exception ex) {
            throw new AuthException("bad access key");
        }
    }

    private static JsonObject json(String part) {
        try {
            return JsonParser.parseString(new String(Base64.getUrlDecoder().decode(part), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (Exception e) {
            throw new AuthException("malformed token");
        }
    }

    private static String text(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e != null && e.isJsonPrimitive() ? e.getAsString() : null;
    }
}
