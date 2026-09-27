package com.virtugene.app.plugins;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

/** Bundled Chinese OCR: no upload, no screenshot storage, no model download. */
@CapacitorPlugin(name = "ChatTextRecognition")
public class ChatTextRecognitionPlugin extends Plugin {
    @PluginMethod
    public void recognize(PluginCall call) {
        String data = call.getString("dataUrl", "");
        if (data.length() > 16000000 || !data.startsWith("data:image/")) { call.reject("截图格式或大小不支持"); return; }
        try {
            byte[] bytes = Base64.decode(data.substring(data.indexOf(',') + 1), Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) { call.reject("无法读取截图"); return; }
            TextRecognizer client = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
            client.process(InputImage.fromBitmap(bitmap, 0)).addOnSuccessListener(text -> {
                JSArray lines = new JSArray();
                // Preserve wrapped paragraphs: visual lines are not separate messages.
                for (Text.TextBlock block : text.getTextBlocks()) {
                    Rect rect = block.getBoundingBox(); if (rect == null) continue;
                    JSObject row = new JSObject(); row.put("text", block.getText()); row.put("left", rect.left);
                    row.put("right", rect.right); row.put("top", rect.top); lines.put(row);
                }
                JSObject result = new JSObject(); result.put("lines", lines); result.put("width", bitmap.getWidth()); call.resolve(result);
            }).addOnFailureListener(error -> call.reject("识别失败，请改用文字导入"))
              .addOnCompleteListener(task -> { client.close(); bitmap.recycle(); });
        } catch (Exception error) { call.reject("无法读取截图，请改用文字导入"); }
    }
}
