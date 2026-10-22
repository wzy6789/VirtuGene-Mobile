package com.virtugene.app.plugins;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Tests the production callback guard, with no Android device/audio/model call. */
public class AudioSessionAuthorityTest {
    @Test public void oldServiceEndCannotCloseReplacementSession() {
        AudioSessionAuthority authority = new AudioSessionAuthority(new Object());
        long first = authority.begin(); int[] closed = { 0 };
        Runnable queuedEnd = authority.guard(first, () -> closed[0]++);
        authority.invalidate(); long replacement = authority.begin();
        queuedEnd.run(); assertEquals(0, closed[0]);
        authority.guard(replacement, () -> closed[0]++).run(); assertEquals(1, closed[0]);
    }
    @Test public void rebuildingTheSameLogicalCallRevokesOldTimerAndDeviceCallbacks() {
        AudioSessionAuthority authority = new AudioSessionAuthority(new Object());
        long first = authority.begin(); int[] oldActions = { 0 }, freshActions = { 0 };
        Runnable timer = authority.guard(first, () -> oldActions[0]++);
        Runnable added = authority.guard(first, () -> oldActions[0]++);
        Runnable removed = authority.guard(first, () -> oldActions[0]++);
        authority.invalidate(); long rebuilt = authority.begin(); assertNotEquals(first, rebuilt);
        timer.run(); added.run(); removed.run(); assertEquals(0, oldActions[0]);
        authority.guard(rebuilt, () -> freshActions[0]++).run(); assertEquals(1, freshActions[0]);
    }
    @Test public void oldFocusGainOrLossCannotMutateNewSession() {
        AudioSessionAuthority authority = new AudioSessionAuthority(new Object());
        long first = authority.begin(); int[] focusEvents = { 0 };
        Runnable gain = authority.guard(first, () -> focusEvents[0]++);
        Runnable loss = authority.guard(first, () -> focusEvents[0]++);
        authority.invalidate(); long fresh = authority.begin();
        gain.run(); loss.run(); assertEquals(0, focusEvents[0]);
        authority.guard(fresh, () -> focusEvents[0]++).run(); assertEquals(1, focusEvents[0]);
    }
    @Test public void closedSessionCannotExecuteAQueuedCallback() {
        AudioSessionAuthority authority = new AudioSessionAuthority(new Object());
        long session = authority.begin(); int[] actions = { 0 };
        Runnable callback = authority.guard(session, () -> actions[0]++);
        authority.invalidate(); callback.run(); assertEquals(0, actions[0]);
    }
    @Test public void callbackCheckAndActionShareTheLifecycleLock() throws Exception {
        Object lock = new Object(); AudioSessionAuthority authority = new AudioSessionAuthority(lock);
        long session = authority.begin(); CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), closed = new CountDownLatch(1);
        Thread callback = new Thread(authority.guard(session, () -> {
            entered.countDown();
            try { if (!release.await(2, TimeUnit.SECONDS)) throw new AssertionError("callback not released"); }
            catch (InterruptedException error) { throw new AssertionError(error); }
        }));
        callback.start(); assertTrue(entered.await(2, TimeUnit.SECONDS));
        Thread close = new Thread(() -> { authority.invalidate(); closed.countDown(); }); close.start();
        try { assertFalse(closed.await(50, TimeUnit.MILLISECONDS)); }
        finally { release.countDown(); }
        callback.join(2000); close.join(2000); assertEquals(0, closed.getCount());
    }
}
