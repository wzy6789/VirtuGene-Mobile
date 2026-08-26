package com.virtugene.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int STATUS_BAR_COLOR = 0xFF0F0F1A;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        applySystemBarColors();

        // Capacitor 的 SystemBars 插件在 WebView 加载后会把 decorView 背景设为主题
        // windowBackground；再延迟强制一次，确保状态栏区域始终是品牌深色（不透白）
        new Handler(Looper.getMainLooper()).postDelayed(this::applySystemBarColors, 300);
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
