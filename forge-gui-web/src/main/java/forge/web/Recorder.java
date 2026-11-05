package forge.web;

import com.google.gson.JsonObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.GZIPOutputStream;

/**
 * A match's replay (PROTOCOL.md "Replays"), as gzipped JSON lines. The first line is a header; each other line is
 * {@code {"ms":<since start>,"m":<message>}} for the table's messages, {@code {"ms":..,"s":<seat>,"m":..}} for one
 * seat's own, or {@code {"ms":..,"board":..}} for a saved board (all of them after the rest); the last is a full
 * state of the final board marked {@code "snapshot":true}, with the match's result, which a viewer doesn't apply
 * (it checks a replay against it).
 */
final class Recorder {
    static final int FORMAT = 2;

    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    private final Writer out;
    private final long start = System.nanoTime();
    private final List<String> boards = new ArrayList<>();
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
            line("{\"ms\":" + ms() + ",\"m\":" + message + "}");
        }
    }

    synchronized void add(int seat, String message) {
        if (!finished) {
            line("{\"ms\":" + ms() + ",\"s\":" + seat + ",\"m\":" + message + "}");
        }
    }

    /** Saved boards are written together at the end, where gzip finds what one turn's board repeats of the last. */
    synchronized void board(JsonObject board) {
        if (!finished) {
            boards.add("{\"ms\":" + ms() + ",\"board\":" + board + "}");
        }
    }

    /** Closes the replay with the final board and returns the file. */
    synchronized byte[] finish(String finalState, JsonObject result) {
        if (!finished) {
            boards.forEach(this::line);
            boards.clear();
            line("{\"ms\":" + ms() + ",\"snapshot\":true,\"result\":" + result
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

    private long ms() {
        return (System.nanoTime() - start) / 1_000_000;
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
