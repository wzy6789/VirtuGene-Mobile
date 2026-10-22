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
    /** An uninitialized track still needs release, but pause is not a valid operation. */
    public static int output(java.util.function.BooleanSupplier initialized, Runnable pause, Runnable flush, Runnable release) {
        int failures = 0;
        try { if (initialized.getAsBoolean()) failures += run(pause, flush); }
        catch (RuntimeException error) { failures++; }
        return failures + run(release);
    }
}
