package com.virtugene.app.plugins;

/** Best-effort teardown: a broken device operation must not skip other releases. */
public final class AudioCleanup {
    private AudioCleanup() {}
    public static int run(Runnable... steps) {
        int failures = 0;
        for (Runnable step : steps) {
            try { step.run(); } catch (RuntimeException error) { failures++; }
        }
        return failures;
    }
}
