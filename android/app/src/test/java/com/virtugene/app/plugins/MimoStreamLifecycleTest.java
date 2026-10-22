package com.virtugene.app.plugins;

import org.junit.Test;
import static org.junit.Assert.*;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.Semaphore;

/** JVM lifecycle tests: no Android device, socket, API key or model call. */
public class MimoStreamLifecycleTest {
    private Object stream(MimoStreamPlugin plugin) throws Exception {
        Class<?> type = Class.forName("com.virtugene.app.plugins.MimoStreamPlugin$Stream");
        Constructor<?> ctor = type.getDeclaredConstructor(MimoStreamPlugin.class);
        ctor.setAccessible(true); return ctor.newInstance(plugin);
    }
    private Semaphore capacity(MimoStreamPlugin plugin) throws Exception {
        Field field = MimoStreamPlugin.class.getDeclaredField("capacity");
        field.setAccessible(true); return (Semaphore) field.get(plugin);
    }
    private void invoke(Object stream, String method) throws Exception {
        Method target = stream.getClass().getDeclaredMethod(method);
        target.setAccessible(true); target.invoke(stream);
    }
    @Test public void cancelledOpeningRetainsCapacityUntilOpeningStops() throws Exception {
        MimoStreamPlugin plugin = new MimoStreamPlugin();
        try {
            Semaphore capacity = capacity(plugin); assertTrue(capacity.tryAcquire());
            Object stream = stream(plugin);
            invoke(stream, "close"); assertEquals(3, capacity.availablePermits());
            invoke(stream, "finishOpening"); assertEquals(4, capacity.availablePermits());
            invoke(stream, "close"); invoke(stream, "finishOpening");
            assertEquals(4, capacity.availablePermits());
        } finally { plugin.handleOnDestroy(); }
    }
    @Test public void successfulOpeningRetainsCapacityUntilStreamCloses() throws Exception {
        MimoStreamPlugin plugin = new MimoStreamPlugin();
        try {
            Semaphore capacity = capacity(plugin); assertTrue(capacity.tryAcquire());
            Object stream = stream(plugin);
            invoke(stream, "finishOpening"); assertEquals(3, capacity.availablePermits());
            invoke(stream, "close"); assertEquals(4, capacity.availablePermits());
            invoke(stream, "close"); assertEquals(4, capacity.availablePermits());
        } finally { plugin.handleOnDestroy(); }
    }
    @Test public void cancellingFourOpeningsDoesNotPermitAFifthBeforeCleanup() throws Exception {
        MimoStreamPlugin plugin = new MimoStreamPlugin();
        try {
            Semaphore capacity = capacity(plugin); Object[] pending = new Object[4];
            for (int i = 0; i < 4; i++) {
                assertTrue(capacity.tryAcquire()); pending[i] = stream(plugin); invoke(pending[i], "close");
            }
            assertFalse(capacity.tryAcquire());
            invoke(pending[0], "finishOpening"); assertTrue(capacity.tryAcquire());
            assertFalse(capacity.tryAcquire());
            capacity.release();
            for (int i = 1; i < 4; i++) invoke(pending[i], "finishOpening");
            assertEquals(4, capacity.availablePermits());
        } finally { plugin.handleOnDestroy(); }
    }
    @Test public void failedDisconnectStillClosesInputAndReturnsCapacityOnce() throws Exception {
        MimoStreamPlugin plugin = new MimoStreamPlugin();
        try {
            Semaphore capacity = capacity(plugin); assertTrue(capacity.tryAcquire());
            Object stream = stream(plugin); invoke(stream, "finishOpening");
            int[] calls = new int[2];
            java.net.HttpURLConnection connection = new java.net.HttpURLConnection(new java.net.URL("https://example.invalid")) {
                @Override public void disconnect() { calls[0]++; throw new IllegalStateException("mock disconnect failure"); }
                @Override public boolean usingProxy() { return false; }
                @Override public void connect() {}
            };
            java.io.InputStream input = new java.io.ByteArrayInputStream(new byte[0]) {
                @Override public void close() { calls[1]++; }
            };
            Field connectionField = stream.getClass().getDeclaredField("connection");
            connectionField.setAccessible(true); connectionField.set(stream, connection);
            Field inputField = stream.getClass().getDeclaredField("input");
            inputField.setAccessible(true); inputField.set(stream, input);
            invoke(stream, "close"); invoke(stream, "close");
            assertEquals(1, calls[0]); assertEquals(1, calls[1]);
            assertEquals(4, capacity.availablePermits());
            assertNull(connectionField.get(stream)); assertNull(inputField.get(stream));
        } finally { plugin.handleOnDestroy(); }
    }
}
