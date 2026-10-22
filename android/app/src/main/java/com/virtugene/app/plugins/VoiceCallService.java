package com.virtugene.app.plugins;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.content.Context;
import android.net.Uri;
import java.util.function.Consumer;
import com.virtugene.app.MainActivity;

/** Visible, non-restarting call output, with microphone type only when capture is enabled. */
public final class VoiceCallService extends Service {
    public static final String END = "com.virtugene.app.END_VOICE_CALL";
    private static final String CHANNEL = "virtugene_voice_calls";
    static final String SESSION = "nativeSession";
    private static final VoiceCallServiceSessions sessions = new VoiceCallServiceSessions();
    private VoiceCallServiceSessions.Ticket owner;
    private int ownerStartId;
    static VoiceCallServiceSessions.Ticket register(Runnable end) { return sessions.register(end); }
    static VoiceCallServiceSessions.Ticket register(Runnable end, boolean captureEnabled) { return sessions.register(end, captureEnabled); }
    static long requestCapture(Context context, VoiceCallServiceSessions.Ticket ticket, boolean enabled, Consumer<RuntimeException> reply) {
        return sessions.requestCapture(ticket, enabled, reply,
            () -> context.startService(new Intent(context, VoiceCallService.class).putExtra(SESSION, ticket.id)));
    }
    static boolean cancelCapture(Context context, VoiceCallServiceSessions.Ticket ticket, long serial) {
        return sessions.cancelCapture(ticket, serial,
            () -> context.startService(new Intent(context, VoiceCallService.class).putExtra(SESSION, ticket.id)));
    }
    static void stopMatching(Context context, VoiceCallServiceSessions.Ticket ticket) {
        // Stop is part of the ownership transaction: a replacement cannot be
        // registered between removing this owner and sending its stop request.
        sessions.release(ticket, () -> context.stopService(new Intent(context, VoiceCallService.class)));
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String ticketId = intent == null ? null : intent.getStringExtra(SESSION);
        if (intent != null && END.equals(intent.getAction())) {
            sessions.end(owner, ticketId, () -> stopSelfResult(startId));
            return START_NOT_STICKY;
        }
        Runnable[] completion = { () -> {} };
        if (!sessions.bind(ticketId, accepted -> {
            RuntimeException failure = null;
            try { activate(accepted, startId); }
            catch (RuntimeException error) { failure = error; }
            completion[0] = sessions.activationFinished(accepted, failure);
            if (failure != null) {
                // A denied type transition must not crash the app. Restore the
                // previously accepted type before reporting the failed switch.
                try { activate(accepted, startId); }
                catch (RuntimeException ignored) { completion[0] = accepted.end; }
            }
        })) {
            // A delayed start for a closed ticket cannot replace a new owner.
            sessions.stopIfEmpty(() -> stopSelfResult(startId));
            return START_NOT_STICKY;
        }
        completion[0].run();
        return START_NOT_STICKY;
    }
    private void activate(VoiceCallServiceSessions.Ticket accepted, int startId) {
        owner = accepted; ownerStartId = startId;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "角色语音通话", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 73, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // Extras alone do not distinguish PendingIntent identity. A unique data
        // URI prevents FLAG_UPDATE_CURRENT from turning an old END into a new one.
        Intent endIntent = new Intent(this, VoiceCallService.class).setAction(END)
            .setData(Uri.parse("virtugene://voice-call/end/" + owner.id)).putExtra(SESSION, owner.id);
        PendingIntent end = PendingIntent.getService(this, 74, endIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Notification notification = builder.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("角色语音通话")
            .setContentText(accepted.captureEnabled ? "麦克风会话运行中，点击返回；挂断可立即释放音频资源。" : "文字输入，角色声音回复；麦克风未启用。点击返回或挂断。")
            .setContentIntent(content).setOngoing(true).setCategory(Notification.CATEGORY_CALL)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "挂断", end).build()).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(73, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            | (accepted.captureEnabled ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0));
        else startForeground(73, notification);
    }
    @Override public void onTaskRemoved(Intent rootIntent) {
        if (owner != null) sessions.end(owner, owner.id, () -> stopSelfResult(ownerStartId));
    }
    @Override public void onDestroy() {
        VoiceCallServiceSessions.Ticket destroyedOwner = owner; owner = null;
        sessions.release(destroyedOwner, null);
        // Notify the ticket owned by this instance, never the latest registry
        // value. Its native generation guard rejects an already closed session.
        if (destroyedOwner != null) destroyedOwner.end.run();
        super.onDestroy();
    }
}
