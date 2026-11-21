package com.virtugene.app.plugins;

import android.app.Activity;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.view.View;
import android.view.ViewGroup;
import android.view.Gravity;
import android.widget.FrameLayout;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The native inset and its icons use the same resolved theme as the WebView. */
@CapacitorPlugin(name = "SystemAppearance")
public class SystemAppearancePlugin extends Plugin {
    private static final String PREFERENCES = "virtugene-system-appearance";

    public static void applySaved(Activity activity) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
        boolean dark = activity.getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE).getBoolean("dark", true);
        int color = dark ? 0xFF0C1119 : 0xFFF6F8FB;
        Window window = activity.getWindow();
        window.setStatusBarColor(color);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.setStatusBarContrastEnforced(false);
        // API24–25 only have light navigation icons; keep a contrasting base.
        window.setNavigationBarColor(Build.VERSION.SDK_INT < Build.VERSION_CODES.O ? 0xFF0C1119 : color);
        window.getDecorView().setBackgroundColor(color);
        // Android 15+ draws a transparent status bar and ignores its color.
        // Paint the actual area behind the icons, including WebViews that inset
        // their content natively instead of exposing a CSS safe-area height.
        View decor = window.getDecorView();
        if (decor instanceof ViewGroup) {
            ViewGroup host = (ViewGroup) decor;
            View protection = host.findViewWithTag("vg-statusbar-protection");
            if (protection == null) {
                protection = new View(activity);
                protection.setTag("vg-statusbar-protection");
                protection.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                protection.setClickable(false);
                host.addView(protection, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
            }
            protection.setBackgroundColor(color);
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
            if (insets != null) {
                ViewGroup.LayoutParams params = protection.getLayoutParams();
                params.height = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top;
                protection.setLayoutParams(params);
            }
            protection.bringToFront();
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    @PluginMethod
    public void setTheme(PluginCall call) {
        Boolean dark = call.getBoolean("dark");
        Activity activity = getActivity();
        if (dark == null || activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("System appearance unavailable"); return;
        }
        activity.runOnUiThread(() -> {
            activity.getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE).edit().putBoolean("dark", dark).apply();
            applySaved(activity);
            call.resolve();
        });
    }

    private void restore() {
        // Run after Capacitor's theme/configuration handlers have updated their bars.
        new Handler(Looper.getMainLooper()).post(() -> applySaved(getActivity()));
    }

    @Override protected void handleOnResume() { super.handleOnResume(); restore(); }
    @Override protected void handleOnConfigurationChanged(Configuration config) {
        super.handleOnConfigurationChanged(config); restore();
    }
}
