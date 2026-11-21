package com.virtugene.app.plugins;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/** Debug-only OS test host: no bridge, database, microphone, audio or network. */
public final class VoiceAcceptanceActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView text = new TextView(this);
        text.setText("语音系统隔离验收 · 未启用麦克风或模型");
        setContentView(text);
    }
}
