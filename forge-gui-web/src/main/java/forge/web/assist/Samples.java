package forge.web.assist;

import java.util.Arrays;

/** Durations in nanoseconds, for the per-match stats line. Not thread-safe. */
public final class Samples {
    private long[] v = new long[256];
    private int n;
    private long max;

    public void add(long nanos) {
        if (n == v.length) {
            v = Arrays.copyOf(v, n * 2);
        }
        v[n++] = nanos;
        max = Math.max(max, nanos);
    }

    public int count() {
        return n;
    }

    public long maxNanos() {
        return max;
    }

    public long p95Nanos() {
        if (n == 0) {
            return 0;
        }
        long[] s = Arrays.copyOf(v, n);
        Arrays.sort(s);
        return s[Math.min(n - 1, (int) Math.ceil(n * 0.95) - 1)];
    }

    public String summary() {
        return String.format("%d, p95 %.2f ms, max %.2f ms", n, p95Nanos() / 1e6, max / 1e6);
    }
}
