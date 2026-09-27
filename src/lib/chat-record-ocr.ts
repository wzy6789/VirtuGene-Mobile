import { Capacitor, registerPlugin } from '@capacitor/core';
import { mergeChatRecords, type ChatRecord } from './chat-style-import';
const recognizer = registerPlugin<{ recognize(input: { dataUrl: string }): Promise<{ lines: Array<{text: string; left: number; right: number; top: number}>; width: number }> }>('ChatTextRecognition');
export const hasLocalChatOcr = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export async function recognizeChatScreenshot(file: File): Promise<ChatRecord[]> {
  if (!hasLocalChatOcr()) throw Error('电脑预览请使用粘贴文字或 TXT；Android 安装版支持设备内截图识别。');
  if (file.size > 12 * 1024 * 1024) throw Error('单张截图请控制在 12 MB 以内。');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40000000) throw Error('长截图过长，请分成几张上传。');
    const scale = Math.min(1, 1440 / bitmap.width);
    const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
    let records: ChatRecord[] = [];
    for (let y = 0; y < height; y += 1400) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.min(1600, height - y);
      const ctx = canvas.getContext('2d'); if (!ctx) throw Error('无法读取截图。');
      ctx.drawImage(bitmap, 0, y / scale, bitmap.width, canvas.height / scale, 0, 0, width, canvas.height);
      const result = await recognizer.recognize({ dataUrl: canvas.toDataURL('image/jpeg', .94) });
      const lines = result.lines.sort((a,b) => a.top - b.top);
      const batch: ChatRecord[] = [];
      for (const line of lines) {
        // Centered notices and timestamps are deliberately excluded. Review is mandatory.
        const speaker = line.right > width * .82 && line.left > width * .28 ? '右侧' : line.left < width * .3 && line.right < width * .84 ? '左侧' : '';
        if (!speaker || /^\d{1,2}:\d{2}$/.test(line.text.trim())) continue;
        batch.push({ speaker, text: line.text.trim() });
      }
      records = mergeChatRecords(records, batch);
      canvas.width = 0; canvas.height = 0;
    }
    return records;
  } finally { bitmap.close(); }
}
