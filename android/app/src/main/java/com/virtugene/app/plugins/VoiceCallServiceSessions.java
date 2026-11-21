package com.virtugene.app.plugins;

import java.util.UUID;
import java.util.function.Consumer;

/** Process-local ownership for service intents; old instances never consume a new owner. */
final class VoiceCallServiceSessions {
    static final class Ticket {
        final String id = UUID.randomUUID().toString();
        final Runnable end;
        boolean captureEnabled;
        boolean confirmedCapture;
        long modeSerial;
        Consumer<RuntimeException> modeReply;
        Ticket(Runnable end, boolean captureEnabled) { this.end = end; this.captureEnabled = this.confirmedCapture = captureEnabled; }
    }
    private Ticket current;

    synchronized Ticket register(Runnable end) { return register(end, true); }
    synchronized Ticket register(Runnable end, boolean captureEnabled) { current = new Ticket(end, captureEnabled); return current; }
    synchronized long requestCapture(Ticket owner, boolean enabled, Consumer<RuntimeException> reply, Runnable update) {
        if (owner == null || current != owner) return -1;
        if (owner.modeReply != null) throw new IllegalStateException("mode-request-pending");
        boolean previous = owner.captureEnabled;
        owner.captureEnabled = enabled;
        owner.modeReply = reply;
        long serial = ++owner.modeSerial;
        try { update.run(); }
        catch (RuntimeException error) { owner.captureEnabled = previous; owner.modeReply = null; throw error; }
        return serial;
    }
    synchronized boolean cancelCapture(Ticket owner, long serial, Runnable update) {
        if (owner == null || current != owner || owner.modeSerial != serial || owner.modeReply == null) return false;
        owner.modeReply = null; owner.captureEnabled = owner.confirmedCapture;
        update.run(); return true;
    }
    synchronized Runnable activationFinished(Ticket owner, RuntimeException error) {
        if (owner == null || current != owner) return () -> {};
        Consumer<RuntimeException> reply = owner.modeReply; owner.modeReply = null;
        if (error == null) owner.confirmedCapture = owner.captureEnabled;
        else owner.captureEnabled = owner.confirmedCapture;
        // Native callbacks acquire another lock, so callers run this result
        // only after leaving bind's registry transaction.
        return reply != null ? () -> reply.accept(error) : error != null ? owner.end : () -> {};
    }
    synchronized Ticket find(String id) { return current != null && current.id.equals(id) ? current : null; }
    synchronized boolean bind(String id, Consumer<Ticket> activate) {
        Ticket owner = find(id);
        if (owner == null) return false;
        // Activation only binds the Android Service and its notification. It
        // never invokes a native audio callback while holding this registry.
        activate.accept(owner);
        return true;
    }
    synchronized boolean release(Ticket owner, Runnable stop) {
        if (owner == null || current != owner) return false;
        current = null;
        if (stop != null) stop.run();
        return true;
    }
    boolean end(Ticket owner, String id, Runnable stop) {
        synchronized (this) {
            if (owner == null || current != owner || !owner.id.equals(id)) return false;
        }
        // Native audio teardown takes its own lock. Deliver the bound callback
        // outside this registry, then recheck before touching the Service.
        owner.end.run();
        synchronized (this) { if (current == owner) stop.run(); }
        return true;
    }
    synchronized void stopIfEmpty(Runnable stop) { if (current == null) stop.run(); }
}
