package com.virtugene.app.plugins;

import static org.junit.Assert.*;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.Instrumentation;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Actual OS service/notification tests, restricted to explicitly opted-in emulators.
 * Permission state is configured BEFORE instrumentation; revoking this process's
 * own runtime permissions inside a test could kill it and invalidate the result.
 * Only the inert debug Activity and capture=false tickets are used. */
@RunWith(AndroidJUnit4.class)
public final class VoiceCallServiceInstrumentationTest {
    private Instrumentation instrumentation;
    private Context context;
    private Activity host;
    private VoiceCallServiceSessions.Ticket owner;
    private boolean notificationGranted;

    @Before public void setUp() throws Exception {
        instrumentation = InstrumentationRegistry.getInstrumentation();
        assertEquals("Explicit emulator acceptance opt-in required", "1",
            InstrumentationRegistry.getArguments().getString("voiceSystemAcceptance"));
        assertTrue("Never run against a user's phone", Build.HARDWARE.equals("ranchu")
            || Build.HARDWARE.equals("goldfish") || Build.HARDWARE.equals("cutf_cvm"));
        assertTrue("Notification permission scenarios require API 33+", Build.VERSION.SDK_INT >= 33);
        context = instrumentation.getTargetContext();
        assertEquals("Do not grant microphone permission for these text-only tests",
            PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO));
        String notificationMode = InstrumentationRegistry.getArguments().getString("notificationPermission");
        assertTrue("Select an explicit notification scenario", "granted".equals(notificationMode) || "denied".equals(notificationMode));
        notificationGranted = "granted".equals(notificationMode);
        assertEquals("Runner must configure notification permission before launch",
            notificationGranted ? PackageManager.PERMISSION_GRANTED : PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS));
        assertNull("Refuse to take ownership of a pre-existing call", runningService());
        Intent launch = new Intent(context, VoiceAcceptanceActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        host = instrumentation.startActivitySync(launch);
        await("Debug host must be visible before foreground service launch", () -> host.hasWindowFocus());
    }

    @After public void tearDown() throws Exception {
        if (owner != null) {
            VoiceCallService.stopMatching(context, owner);
            await("Service resources must leave foreground after cleanup", () -> runningService() == null);
        }
        if (host != null) instrumentation.runOnMainSync(host::finish);
    }

    @Test public void textServiceSurvivesConfiguredNotificationPermissionWithoutMicrophone() throws Exception {
        owner = VoiceCallService.register(() -> {}, false);
        start(owner);
        await("Actual OS must accept a foreground text service", () -> {
            ActivityManager.RunningServiceInfo service = runningService();
            return service != null && service.foreground;
        });
        assertFalse(owner.captureEnabled);
        assertFalse(owner.confirmedCapture);
        assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO));
        if (notificationGranted) {
            await("Granted permission must expose the actual call notification", () -> notification() != null, 20_000);
            assertNotNull(notification().getNotification().actions);
            assertEquals(1, notification().getNotification().actions.length);
        } else {
            // Test the OS permission and continued FGS operation. An app's
            // getActiveNotifications() is not proof of SystemUI drawer visibility.
            assertFalse(context.getSystemService(NotificationManager.class).areNotificationsEnabled());
        }
    }

    @Test public void oldNotificationCannotEndReplacementAndCurrentActionEndsService() throws Exception {
        assertTrue("Select this method only in the granted-permission run", notificationGranted);
        AtomicInteger oldEnds = new AtomicInteger(), currentEnds = new AtomicInteger();
        owner = VoiceCallService.register(oldEnds::incrementAndGet, false);
        start(owner);
        await("Initial notification", () -> notification() != null, 20_000);
        PendingIntent oldEnd = notification().getNotification().actions[0].actionIntent;
        owner = VoiceCallService.register(currentEnds::incrementAndGet, false);
        start(owner);
        await("Replacement needs a distinct actual PendingIntent", () -> notification() != null
            && !oldEnd.equals(notification().getNotification().actions[0].actionIntent));
        PendingIntent currentEnd = notification().getNotification().actions[0].actionIntent;
        send(oldEnd);
        long settle = SystemClock.elapsedRealtime() + 1000;
        while (SystemClock.elapsedRealtime() < settle) {
            assertEquals("Old END must not reach the new owner", 0, currentEnds.get());
            assertNotNull("Old END must not destroy the replacement service", runningService());
            SystemClock.sleep(20);
        }
        assertEquals("Stale owner must not be reactivated", 0, oldEnds.get());
        send(currentEnd);
        await("Current notification END must stop its own service", () -> currentEnds.get() > 0 && runningService() == null);
    }

    private void start(VoiceCallServiceSessions.Ticket ticket) {
        assertFalse("Never allocate a microphone ticket", ticket.captureEnabled);
        context.startForegroundService(new Intent(context, VoiceCallService.class).putExtra(VoiceCallService.SESSION, ticket.id));
    }
    private void send(PendingIntent action) throws Exception {
        CountDownLatch sent = new CountDownLatch(1);
        action.send(context, 0, null, (intent, resultIntent, code, data, extras) -> sent.countDown(), new Handler(Looper.getMainLooper()));
        assertTrue("Actual PendingIntent delivery acknowledgement", sent.await(5, TimeUnit.SECONDS));
        instrumentation.waitForIdleSync();
    }
    private ActivityManager.RunningServiceInfo runningService() {
        for (ActivityManager.RunningServiceInfo service : context.getSystemService(ActivityManager.class).getRunningServices(100))
            if (VoiceCallService.class.getName().equals(service.service.getClassName())) return service;
        return null;
    }
    private StatusBarNotification notification() {
        for (StatusBarNotification row : context.getSystemService(NotificationManager.class).getActiveNotifications())
            if (row.getId() == 73) return row;
        return null;
    }
    private static void await(String description, BooleanSupplier ready) {
        await(description, ready, 5000);
    }
    private static void await(String description, BooleanSupplier ready, long timeoutMs) {
        // Notification publication can be deferred by Android. This is a test
        // observation deadline, not a call-start or response-latency promise.
        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        while (!ready.getAsBoolean() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(20);
        assertTrue(description, ready.getAsBoolean());
    }
}
