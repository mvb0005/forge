package forge.web;

import com.google.gson.JsonObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPOutputStream;

/**
 * One seat's replay (PROTOCOL.md "Replays"): every message the seat was sent, in order, whether or not a
 * browser was connected, as gzipped JSON lines. The first line is a header; each other line is
 * {@code {"ms":<since start>,"m":<message>}}; the last is a full state of the final board marked
 * {@code "snapshot":true}, with the match's result, which a viewer doesn't apply (it checks a replay against it).
 */
final class Recorder {
    static final int FORMAT = 1;

    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    private final Writer out;
    private final long start = System.nanoTime();
    private int lines;
    private boolean finished;

    Recorder(JsonObject header) {
        try {
            out = new OutputStreamWriter(new GZIPOutputStream(bytes, 1 << 16), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        header.addProperty("replay", FORMAT);
        line(header.toString());
    }

    synchronized void add(String message) {
        if (!finished) {
            line("{\"ms\":" + (System.nanoTime() - start) / 1_000_000 + ",\"m\":" + message + "}");
        }
    }

    /** Closes the replay with the final board and returns the file. */
    synchronized byte[] finish(String finalState, JsonObject result) {
        if (!finished) {
            line("{\"ms\":" + (System.nanoTime() - start) / 1_000_000 + ",\"snapshot\":true,\"result\":" + result
                    + (finalState != null ? ",\"m\":" + finalState : "") + "}");
            finished = true;
            try {
                out.close();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        return bytes.toByteArray();
    }

    synchronized int lines() {
        return lines;
    }

    private void line(String s) {
        try {
            out.write(s);
            out.write('\n');
            lines++;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
