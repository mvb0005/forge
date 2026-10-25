package forge.web;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * The web frontend's stand-in for Swing's event dispatch thread. Forge's GUI layer expects one
 * UI thread: IGuiBase.invokeInEdt* run here, and every client action (selectCard, OK, ...) is
 * handed to the game controller from here, never from a Netty I/O thread.
 */
public final class WebEdt {
    private static volatile Thread thread;
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Web EDT");
        t.setDaemon(true);
        thread = t;
        return t;
    });

    private WebEdt() {
    }

    public static boolean isEdt() {
        return Thread.currentThread() == thread;
    }

    public static void invokeLater(Runnable r) {
        EXEC.execute(r);
    }

    public static void invokeNow(Runnable r) {
        if (isEdt()) {
            r.run();
        } else {
            invokeAndWait(r);
        }
    }

    public static void invokeAndWait(Runnable r) {
        if (isEdt()) {
            r.run();
            return;
        }
        Future<?> f = EXEC.submit(r);
        try {
            f.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            throw new RuntimeException(e.getCause() != null ? e.getCause() : e);
        }
    }
}
