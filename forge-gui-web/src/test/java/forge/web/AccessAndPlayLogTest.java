package forge.web;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.testng.annotations.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertNull;
import static org.testng.Assert.assertTrue;
import static org.testng.Assert.expectThrows;

public class AccessAndPlayLogTest {
    @Test
    public void accessTokenNamesThePerson() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        KeyPair pair = gen.generateKeyPair();
        AccessIdentity access = new AccessIdentity("https://team.example", "aud-1", Map.of("k", pair.getPublic()));

        String token = jwt(pair, "k", "{\"alg\":\"RS256\",\"kid\":\"k\"}",
                claims("https://team.example", "aud-1", Instant.now().getEpochSecond() + 600, "Ada@Example.com"));
        assertEquals(access.email(token), "ada@example.com");
        assertEquals(AccessIdentity.displayName("ada@example.com"), "ada");
        assertEquals(AccessIdentity.tokenFrom(null, "other=1; CF_Authorization=" + token), token);

        String wrongAud = jwt(pair, "k", "{\"alg\":\"RS256\",\"kid\":\"k\"}",
                claims("https://team.example", "other", Instant.now().getEpochSecond() + 600, "ada@example.com"));
        expectThrows(AuthException.class, () -> access.email(wrongAud));

        String tampered = token.substring(0, token.length() - 4) + "AAAA";
        expectThrows(AuthException.class, () -> access.email(tampered));

        String service = jwt(pair, "k", "{\"alg\":\"RS256\",\"kid\":\"k\"}",
                "{\"iss\":\"https://team.example\",\"aud\":\"aud-1\",\"exp\":" + (Instant.now().getEpochSecond() + 600) + ",\"common_name\":\"claude\"}");
        AuthException refused = expectThrows(AuthException.class, () -> access.email(service));
        assertEquals(refused.getMessage(), "token is not a person");
    }

    @Test
    public void unknownKeyIdIsRefusedWithoutFetching() throws Exception {
        KeyPair pair = KeyPairGenerator.getInstance("RSA").generateKeyPair();
        // The issuer is unreachable, so a fetch would fail with a different message.
        AccessIdentity access = new AccessIdentity("https://unreachable.invalid", "aud-1", Map.of("k", pair.getPublic()));
        String token = jwt(pair, "made-up", "{\"alg\":\"RS256\",\"kid\":\"made-up\"}",
                "{\"iss\":\"https://unreachable.invalid\",\"aud\":\"aud-1\",\"exp\":" + (Instant.now().getEpochSecond() + 600) + ",\"email\":\"a@b.c\"}");
        AuthException refused = expectThrows(AuthException.class, () -> access.email(token));
        assertEquals(refused.getMessage(), "unknown key");
    }

    @Test
    public void playLogKeepsAGameAndAbandonsOneThatWasStillRunning() throws Exception {
        Path dir = Files.createTempDirectory("play-log");
        Path file = dir.resolve("games.json");
        PlayLog log = new PlayLog(file);

        JsonObject playing = game("g1", "ada@example.com");
        log.begin(playing);
        JsonObject done = game("g2", "ada@example.com");
        log.begin(done);
        JsonObject outcome = new JsonObject();
        outcome.addProperty("gameOver", true);
        outcome.addProperty("winner", "ada");
        outcome.addProperty("turn", 14);
        outcome.addProperty("summary", "ada won on turn 14");
        outcome.add("log", com.google.gson.JsonParser.parseString("[\"Turn 1\"]"));
        log.finish("g2", outcome);

        JsonObject list = log.list("ada@example.com");
        assertEquals(list.getAsJsonArray("games").size(), 2);
        assertEquals(list.getAsJsonArray("games").get(0).getAsJsonObject().get("id").getAsString(), "g2");
        assertNull(log.one("other@example.com", "g2"));
        assertEquals(log.one("ada@example.com", "g2").getAsJsonArray("log").get(0).getAsString(), "Turn 1");
        assertEquals(log.list(null).getAsJsonArray("games").size(), 0);

        PlayLog restarted = new PlayLog(file);
        JsonObject abandoned = restarted.one("ada@example.com", "g1");
        assertEquals(abandoned.get("status").getAsString(), "abandoned");
        assertTrue(abandoned.get("summary").getAsString().contains("restarted"));
        assertEquals(restarted.one("ada@example.com", "g2").get("status").getAsString(), "finished");
        JsonObject disk = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        assertEquals(disk.get("version").getAsInt(), 1);
    }

    private static JsonObject game(String id, String email) {
        JsonObject g = new JsonObject();
        g.addProperty("id", id);
        g.addProperty("email", email);
        g.addProperty("name", "ada");
        g.addProperty("status", "playing");
        g.addProperty("startedAt", "2026-10-27T00:00:00Z");
        return g;
    }

    private static String claims(String iss, String aud, long exp, String email) {
        return "{\"iss\":\"" + iss + "\",\"aud\":\"" + aud + "\",\"exp\":" + exp + ",\"email\":\"" + email + "\"}";
    }

    private static String jwt(KeyPair pair, String kid, String header, String payload) throws Exception {
        String h = b64(header.getBytes(StandardCharsets.UTF_8));
        String p = b64(payload.getBytes(StandardCharsets.UTF_8));
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initSign(pair.getPrivate());
        sig.update((h + "." + p).getBytes(StandardCharsets.UTF_8));
        return h + "." + p + "." + b64(sig.sign());
    }

    private static String b64(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
