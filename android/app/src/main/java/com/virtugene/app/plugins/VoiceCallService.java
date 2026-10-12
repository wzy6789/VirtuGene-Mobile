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
import com.virtugene.app.MainActivity;

/** Visible, non-restarting microphone session. No audio or credentials are persisted here. */
public final class VoiceCallService extends Service {
    public static final String END = "com.virtugene.app.END_VOICE_CALL";
    private static final String CHANNEL = "virtugene_voice_calls";
    static volatile Runnable onEnd;
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && END.equals(intent.getAction())) {
            Runnable callback = onEnd; if (callback != null) callback.run();
            stopSelf(); return START_NOT_STICKY;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "角色语音通话", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 73, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent end = PendingIntent.getService(this, 74, new Intent(this, VoiceCallService.class).setAction(END), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Notification notification = builder.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("角色语音通话")
            .setContentText("麦克风会话运行中，点击返回；挂断可立即释放音频资源。")
            .setContentIntent(content).setOngoing(true).setCategory(Notification.CATEGORY_CALL)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "挂断", end).build()).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(73, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(73, notification);
        return START_NOT_STICKY;
    }
    @Override public void onTaskRemoved(Intent rootIntent) { Runnable callback = onEnd; if (callback != null) callback.run(); stopSelf(); }
    @Override public void onDestroy() { Runnable callback = onEnd; onEnd = null; if (callback != null) callback.run(); super.onDestroy(); }
}
