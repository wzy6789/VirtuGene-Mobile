package com.virtugene.app.plugins;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Service ownership contract: no Android AMS/notification/device/model call. */
public class VoiceCallServiceSessionsTest {
    @Test public void textTicketHasNoMicrophoneTypeAndDefaultRemainsVoice() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions();
        VoiceCallServiceSessions.Ticket text = sessions.register(() -> {}, false);
        assertFalse(text.captureEnabled); assertFalse(text.confirmedCapture);
        assertTrue(sessions.register(() -> {}).captureEnabled);
    }
    @Test public void modeAcknowledgementFollowsActivationAndRunsOutsideRegistry() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] acknowledged = { 0 };
        VoiceCallServiceSessions.Ticket text = sessions.register(() -> {}, false);
        assertTrue(sessions.requestCapture(text, true, error -> {
            assertNull(error); assertFalse(Thread.holdsLock(sessions)); acknowledged[0]++;
        }, () -> {}) > 0);
        assertTrue(text.captureEnabled); assertFalse(text.confirmedCapture); assertEquals(0, acknowledged[0]);
        Runnable[] completion = { null };
        assertTrue(sessions.bind(text.id, accepted -> completion[0] = sessions.activationFinished(accepted, null)));
        assertTrue(text.confirmedCapture); assertEquals(0, acknowledged[0]);
        completion[0].run(); assertEquals(1, acknowledged[0]);
    }
    @Test public void failedMicrophoneForegroundTransitionRestoresTextAndReportsFailure() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] failures = { 0 };
        VoiceCallServiceSessions.Ticket text = sessions.register(() -> {}, false);
        RuntimeException denial = new SecurityException("fixture-only");
        sessions.requestCapture(text, true, error -> { assertSame(denial, error); failures[0]++; }, () -> {});
        Runnable completion = sessions.activationFinished(text, denial);
        assertFalse(text.captureEnabled); assertFalse(text.confirmedCapture); assertEquals(0, failures[0]);
        completion.run(); assertEquals(1, failures[0]);
    }
    @Test public void failedServiceIntentDoesNotLeaveAChangedModeOrPendingCallback() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions();
        VoiceCallServiceSessions.Ticket text = sessions.register(() -> {}, false);
        assertThrows(SecurityException.class, () -> sessions.requestCapture(text, true, error -> {}, () -> { throw new SecurityException(); }));
        assertFalse(text.captureEnabled); assertNull(text.modeReply);
        assertTrue(sessions.requestCapture(text, true, error -> {}, () -> {}) > 0);
    }
    @Test public void cancelledPermissionOrServiceWaitCannotReenableMicrophoneFromLateIntent() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] replies = { 0 };
        VoiceCallServiceSessions.Ticket text = sessions.register(() -> {}, false);
        long first = sessions.requestCapture(text, true, error -> replies[0]++, () -> {});
        assertTrue(sessions.cancelCapture(text, first, () -> {})); assertFalse(text.captureEnabled);
        Runnable stale = sessions.activationFinished(text, null); stale.run(); assertEquals(0, replies[0]);
        long second = sessions.requestCapture(text, true, error -> replies[0]++, () -> {});
        assertFalse(sessions.cancelCapture(text, first, () -> {})); assertTrue(text.captureEnabled);
        assertTrue(sessions.cancelCapture(text, second, () -> {})); assertFalse(text.captureEnabled);
    }
    @Test public void staleModeUpdateAndCompletionCannotConsumeReplacementTicket() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] replies = { 0 };
        VoiceCallServiceSessions.Ticket first = sessions.register(() -> {}, false);
        sessions.requestCapture(first, true, error -> replies[0]++, () -> {});
        VoiceCallServiceSessions.Ticket replacement = sessions.register(() -> {}, false);
        assertEquals(-1, sessions.requestCapture(first, true, error -> {}, () -> { throw new AssertionError(); }));
        sessions.activationFinished(first, null).run(); assertEquals(0, replies[0]);
        assertFalse(replacement.captureEnabled); assertSame(replacement, sessions.find(replacement.id));
    }
    @Test public void duplicateModeRequestsCannotReplaceAnUnconfirmedCallback() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions();
        VoiceCallServiceSessions.Ticket text = sessions.register(() -> {}, false);
        sessions.requestCapture(text, true, error -> {}, () -> {});
        assertThrows(IllegalStateException.class, () -> sessions.requestCapture(text, false, error -> {}, () -> {}));
        assertTrue(text.captureEnabled); assertNotNull(text.modeReply);
    }
    @Test public void lateDestroyCannotConsumeOrClearTheReplacementCallback() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] ended = { 0, 0 };
        VoiceCallServiceSessions.Ticket first = sessions.register(() -> ended[0]++);
        VoiceCallServiceSessions.Ticket second = sessions.register(() -> ended[1]++);
        assertFalse(sessions.release(first, null)); first.end.run();
        assertEquals(1, ended[0]); assertEquals(0, ended[1]); assertSame(second, sessions.find(second.id));
    }
    @Test public void lateStartTicketCannotBindToANewerSession() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions();
        VoiceCallServiceSessions.Ticket first = sessions.register(() -> {});
        VoiceCallServiceSessions.Ticket second = sessions.register(() -> {});
        assertNotEquals(first.id, second.id); assertNull(sessions.find(first.id)); assertSame(second, sessions.find(second.id));
    }
    @Test public void oldNotificationCannotEndOrStopTheNewSession() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] ended = { 0 }, stopped = { 0 };
        VoiceCallServiceSessions.Ticket first = sessions.register(() -> ended[0]++);
        VoiceCallServiceSessions.Ticket second = sessions.register(() -> ended[0]++);
        assertFalse(sessions.end(first, first.id, () -> stopped[0]++));
        assertFalse(sessions.end(second, first.id, () -> stopped[0]++));
        assertEquals(0, ended[0]); assertEquals(0, stopped[0]);
        assertTrue(sessions.end(second, second.id, () -> stopped[0]++));
        assertEquals(1, ended[0]); assertEquals(1, stopped[0]);
    }
    @Test public void oldCloseCannotStopAReplacementService() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] stopped = { 0 };
        VoiceCallServiceSessions.Ticket first = sessions.register(() -> {});
        VoiceCallServiceSessions.Ticket second = sessions.register(() -> {});
        assertFalse(sessions.release(first, () -> stopped[0]++));
        assertEquals(0, stopped[0]); assertSame(second, sessions.find(second.id));
    }
    @Test public void repeatedReleaseDoesNotIssueRepeatedServiceStops() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] stopped = { 0 };
        VoiceCallServiceSessions.Ticket owner = sessions.register(() -> {});
        assertTrue(sessions.release(owner, () -> stopped[0]++));
        assertFalse(sessions.release(owner, () -> stopped[0]++));
        assertEquals(1, stopped[0]); assertNull(sessions.find(owner.id));
    }
    @Test public void staleUnboundStartCanOnlyStopWhenNoReplacementExists() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] stopped = { 0 };
        VoiceCallServiceSessions.Ticket owner = sessions.register(() -> {});
        sessions.stopIfEmpty(() -> stopped[0]++); assertEquals(0, stopped[0]);
        sessions.release(owner, null); sessions.stopIfEmpty(() -> stopped[0]++); assertEquals(1, stopped[0]);
    }
    @Test public void replacementRegistrationCannotInterleaveWithOldServiceStop() throws Exception {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions();
        VoiceCallServiceSessions.Ticket owner = sessions.register(() -> {});
        CountDownLatch stopping = new CountDownLatch(1), finishStop = new CountDownLatch(1), registered = new CountDownLatch(1);
        Thread stop = new Thread(() -> sessions.release(owner, () -> {
            stopping.countDown();
            try { if (!finishStop.await(2, TimeUnit.SECONDS)) throw new AssertionError("stop not released"); }
            catch (InterruptedException error) { throw new AssertionError(error); }
        }));
        stop.start(); assertTrue(stopping.await(2, TimeUnit.SECONDS));
        Thread replacement = new Thread(() -> { sessions.register(() -> {}); registered.countDown(); }); replacement.start();
        try { assertFalse(registered.await(50, TimeUnit.MILLISECONDS)); }
        finally { finishStop.countDown(); }
        stop.join(2000); replacement.join(2000); assertEquals(0, registered.getCount());
    }
    @Test public void nativeEndCallbackRunsOutsideRegistryAndCannotStopItsReplacement() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] stopped = { 0 };
        VoiceCallServiceSessions.Ticket[] replacement = { null };
        VoiceCallServiceSessions.Ticket first = sessions.register(() -> {
            assertFalse(Thread.holdsLock(sessions));
            replacement[0] = sessions.register(() -> {});
        });
        assertTrue(sessions.end(first, first.id, () -> stopped[0]++));
        assertEquals(0, stopped[0]); assertSame(replacement[0], sessions.find(replacement[0].id));
    }
    @Test public void staleStartCannotActivateAfterTheRegistryChanges() {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions(); int[] activated = { 0 };
        VoiceCallServiceSessions.Ticket first = sessions.register(() -> {});
        VoiceCallServiceSessions.Ticket second = sessions.register(() -> {});
        assertFalse(sessions.bind(first.id, owner -> activated[0]++));
        assertEquals(0, activated[0]);
        assertTrue(sessions.bind(second.id, owner -> { assertSame(second, owner); activated[0]++; }));
        assertEquals(1, activated[0]);
    }
    @Test public void replacementCannotRegisterBetweenStartCheckAndForegroundActivation() throws Exception {
        VoiceCallServiceSessions sessions = new VoiceCallServiceSessions();
        VoiceCallServiceSessions.Ticket first = sessions.register(() -> {});
        CountDownLatch activating = new CountDownLatch(1), finishActivation = new CountDownLatch(1), registered = new CountDownLatch(1);
        Thread start = new Thread(() -> sessions.bind(first.id, owner -> {
            activating.countDown();
            try { if (!finishActivation.await(2, TimeUnit.SECONDS)) throw new AssertionError("activation not released"); }
            catch (InterruptedException error) { throw new AssertionError(error); }
        }));
        start.start(); assertTrue(activating.await(2, TimeUnit.SECONDS));
        Thread replacement = new Thread(() -> { sessions.register(() -> {}); registered.countDown(); }); replacement.start();
        try { assertFalse(registered.await(50, TimeUnit.MILLISECONDS)); }
        finally { finishActivation.countDown(); }
        start.join(2000); replacement.join(2000); assertEquals(0, registered.getCount());
    }
}
