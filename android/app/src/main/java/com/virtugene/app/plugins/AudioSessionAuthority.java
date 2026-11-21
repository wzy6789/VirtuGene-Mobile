package com.virtugene.app.plugins;

/** Native lifecycle identity, independent of call IDs and capture-route generations. */
final class AudioSessionAuthority {
    private final Object lock;
    private long generation;
    private boolean active;

    AudioSessionAuthority(Object lock) { this.lock = lock; }
    long begin() { synchronized (lock) { active = true; return ++generation; } }
    void invalidate() { synchronized (lock) { active = false; generation++; } }
    Runnable guard(long session, Runnable action) {
        return () -> {
            synchronized (lock) {
                if (active && session == generation) action.run();
            }
        };
    }
}
