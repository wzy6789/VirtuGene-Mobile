package com.virtugene.app.plugins;

import android.webkit.WebView;
import android.app.Activity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Resource cache only. Never clear WebStorage, cookies, history or app data. */
@CapacitorPlugin(name = "ResourceCache")
public class ResourceCachePlugin extends Plugin {
    @PluginMethod
    public void clear(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Resource cache unavailable"); return;
        }
        activity.runOnUiThread(() -> {
            WebView view = getBridge() == null ? null : getBridge().getWebView();
            if (view == null) { call.reject("Resource cache unavailable"); return; }
            try {
                view.clearCache(true);
                JSObject result = new JSObject();
                // Android exposes no byte count or disk-deletion completion event.
                result.put("requested", true);
                call.resolve(result);
            } catch (RuntimeException error) {
                call.reject("Resource cache clear failed");
            }
        });
    }
}
