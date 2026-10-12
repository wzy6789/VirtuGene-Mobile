package com.virtugene.app.plugins;

/** Process-local ownership shared by short voice messages and continuous calls. */
final class AudioCaptureLease {
    private static Object owner;
    static synchronized boolean acquire(Object candidate) {
        if (owner != null && owner != candidate) return false;
        owner = candidate; return true;
    }
    static synchronized void release(Object candidate) { if (owner == candidate) owner = null; }
}
