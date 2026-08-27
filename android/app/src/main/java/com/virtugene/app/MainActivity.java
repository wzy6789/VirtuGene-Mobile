package com.virtugene.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import com.virtugene.app.plugins.NativeAudioRecorderPlugin;

public class MainActivity extends BridgeActivity {

    private static final int STATUS_BAR_COLOR = 0xFF0F0F1A;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 原生录音插件必须在 super.onCreate() 之前注册（load() 在 onCreate 末尾消费插件列表）
        registerPlugin(NativeAudioRecorderPlugin.class);

        super.onCreate(savedInstanceState);

        applySystemBarColors();

        // Capacitor 的 SystemBars 插件在 WebView 加载后会把 decorView 背景设为主题
        // windowBackground；再延迟强制一次，确保状态栏区域始终是品牌深色（不透白）
        new Handler(Looper.getMainLooper()).postDelayed(this::applySystemBarColors, 300);

        // 麦克风（getUserMedia）放行兜底：
        // 系统设置已授予 RECORD_AUDIO（JS 层先用语音插件请求过），但 Capacitor 默认的
        // onPermissionRequest 转发在部分 ROM（如 OPPO/ColorOS）上会误判为拒绝，
        // 导致 getUserMedia 抛 NotAllowedError（"系统同意但 App 说被拒"）。
        // 这里继承 BridgeWebChromeClient，仅对 AUDIO_CAPTURE 直接 grant，
        // 其余行为（对话框/文件选择等）保持 Capacitor 默认。
        postForceMicGrant();
    }

    private void postForceMicGrant() {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                Bridge bridge = getBridge();
                if (bridge == null || bridge.getWebView() == null) return;
                WebView webView = bridge.getWebView();
                webView.setWebChromeClient(new BridgeWebChromeClient(bridge) {
                    @Override
                    public void onPermissionRequest(PermissionRequest request) {
                        boolean audioCapture = false;
                        for (String resource : request.getResources()) {
                            if ("android.webkit.resource.AUDIO_CAPTURE".equals(resource)) {
                                audioCapture = true;
                                break;
                            }
                        }
                        if (audioCapture) {
                            // 系统级 RECORD_AUDIO 仍由系统把关（未授予则底层录音会失败），
                            // 这里只放行 WebView 层，解决"系统已允许但 WebView 拒绝"的问题
                            request.grant(request.getResources());
                            return;
                        }
                        super.onPermissionRequest(request);
                    }
                });
            } catch (Throwable ignored) {
                // 兜底失败不影响其他功能
            }
        }, 200);
    }

    private void applySystemBarColors() {
        Window window = getWindow();
        window.setStatusBarColor(STATUS_BAR_COLOR);
        window.setNavigationBarColor(STATUS_BAR_COLOR);
        window.getDecorView().setBackgroundColor(STATUS_BAR_COLOR);

        // 深色状态栏 → 白色图标（清除 light-status-bar 标志）
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }
}
