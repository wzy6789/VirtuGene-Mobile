package com.virtugene.app.plugins;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import android.util.Base64;

/** Pull-based, bounded SSE transport. Keys never enter logs or persistent storage. */
@CapacitorPlugin(name = "MimoStream")
public class MimoStreamPlugin extends Plugin {
    private final java.util.concurrent.Semaphore capacity = new java.util.concurrent.Semaphore(4);
    private class Stream {
        volatile HttpURLConnection connection;
        volatile InputStream input;
        volatile boolean cancelled;
        private boolean opening = true, released;
        synchronized void close() {
            cancelled = true;
            HttpURLConnection active = connection; connection = null;
            InputStream source = input; input = null;
            // A ROM/socket failure in one cleanup step must not prevent the
            // other resource from closing or leak all future request slots.
            try { if (active != null) active.disconnect(); } catch (RuntimeException ignored) {}
            try { if (source != null) source.close(); } catch (Exception ignored) {}
            // Cancelled map entries may disappear before the socket actually
            // stops. Keep their capacity until opening/cleanup finishes.
            if (!opening && !released) { released = true; capacity.release(); }
        }
        synchronized void finishOpening() { opening = false; if (cancelled) close(); }
    }
    private final ConcurrentHashMap<String, Stream> streams = new ConcurrentHashMap<>();
    private final java.util.concurrent.ExecutorService executor = Executors.newFixedThreadPool(4);
    private volatile boolean destroyed;
    @PluginMethod public void open(PluginCall call) {
        String id = call.getString("id"), key = call.getString("key"), body = call.getString("body");
        if (destroyed || id == null || key == null || body == null || body.length() > 3000000) { call.reject("voice:transport_limit"); return; }
        if (!capacity.tryAcquire()) { call.reject("voice:transport_limit"); return; }
        Stream stream = new Stream();
        if (streams.putIfAbsent(id, stream) != null) { stream.finishOpening(); stream.close(); call.reject("voice:transport_duplicate"); return; }
        try { executor.execute(() -> {
            try {
                if (destroyed || stream.cancelled) throw new Exception();
                HttpURLConnection connection = (HttpURLConnection) new URL("https://api.xiaomimimo.com/v1/chat/completions").openConnection();
                synchronized (stream) {
                    if (stream.cancelled || destroyed) { connection.disconnect(); throw new Exception(); }
                    stream.connection = connection;
                }
                connection.setConnectTimeout(15000); connection.setReadTimeout(45000);
                connection.setInstanceFollowRedirects(false); connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Authorization", "Bearer " + key);
                connection.setRequestProperty("Content-Type", "application/json");
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(bytes.length);
                if (stream.cancelled) throw new Exception();
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                int status = connection.getResponseCode();
                if (stream.cancelled) throw new Exception();
                JSObject result = new JSObject(); result.put("status", status);
                result.put("contentType", connection.getContentType());
                if (status >= 200 && status < 300) {
                    InputStream input = connection.getInputStream();
                    synchronized (stream) {
                        if (stream.cancelled) { input.close(); throw new Exception(); }
                        stream.input = input;
                    }
                }
                else { streams.remove(id, stream); stream.close(); }
                call.resolve(result);
            } catch (Exception error) { streams.remove(id, stream); stream.close(); call.reject(networkError(error)); }
            finally { stream.finishOpening(); }
        }); } catch (java.util.concurrent.RejectedExecutionException error) {
            streams.remove(id, stream); stream.finishOpening(); stream.close(); call.reject("voice:stream_closed");
        }
    }
    @PluginMethod public void read(PluginCall call) {
        String id = call.getString("id"); Stream stream = id == null ? null : streams.get(id);
        if (stream == null || stream.cancelled || stream.input == null) { call.reject("voice:stream_closed"); return; }
        try { executor.execute(() -> {
            try {
                byte[] bytes = new byte[8192]; int count = stream.input.read(bytes);
                if (stream.cancelled) throw new Exception();
                JSObject result = new JSObject(); result.put("done", count < 0);
                if (count > 0) result.put("data", Base64.encodeToString(bytes, 0, count, Base64.NO_WRAP));
                if (count < 0) { streams.remove(id, stream); stream.close(); }
                call.resolve(result);
            } catch (Exception error) { streams.remove(id, stream); stream.close(); call.reject(networkError(error)); }
        }); } catch (java.util.concurrent.RejectedExecutionException error) {
            streams.remove(id, stream); stream.close(); call.reject("voice:stream_closed");
        }
    }
    @PluginMethod public void cancel(PluginCall call) {
        String id = call.getString("id"); Stream stream = id == null ? null : streams.remove(id);
        // Reads may occupy every worker. Cancellation must not queue behind
        // the blocked reads that it is supposed to disconnect.
        if (stream != null) { stream.cancelled = true; new Thread(stream::close, "mimo-cancel").start(); }
        call.resolve();
    }
    @Override protected void handleOnDestroy() {
        destroyed = true;
        // Some ROMs block in TLS disconnect/close. Never run that cleanup on
        // the Activity thread during backgrounding or destruction.
        for (Stream stream : streams.values()) {
            stream.cancelled = true;
            new Thread(stream::close, "mimo-destroy").start();
        }
        streams.clear(); executor.shutdownNow();
    }
    private String networkError(Exception error) {
        // Report only fixed categories, never exception messages or headers.
        if (error instanceof java.net.SocketTimeoutException) return "voice:timeout";
        if (error instanceof java.net.UnknownHostException) return "voice:dns";
        if (error instanceof javax.net.ssl.SSLException) return "voice:tls";
        return "voice:native_network";
    }
}
