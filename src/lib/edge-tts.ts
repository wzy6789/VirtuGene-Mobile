/**
 * Edge-TTS 语音合成 — 浏览器/WebView 直连版
 *
 * 与桌面端 msedge-tts 库同一协议（实测验证）：
 * 1. Sec-MS-GEC 令牌：Unix 秒 → 向下取整到 300s → 转 Windows ticks（100ns）→
 *    拼接 TrustedClientToken → SHA-256 → 大写 HEX（Web Crypto，浏览器可直接算）
 * 2. WebSocket 连接 speech.platform.bing.com（无自定义头，纯浏览器 API）
 * 3. 发 speech.config + SSML 两条消息；二进制帧 "Path:audio\r\n" 之后是 MP3 分片，
 *    收齐到 turn.end 为止
 *
 * ⚠️ 服务器按 User-Agent 校验：只认桌面 Chrome/Edge UA，手机 UA 一律 403。
 * 浏览器 WebSocket 无法自定义头 → 手机端必须在 capacitor.config 里设置
 * android.overrideUserAgent 为桌面 UA（WebView 全局生效，实测任意 Origin 均可）。
 *
 * 失败场景（网络不通/接口变动/被拒）由调用方回退系统语音。
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const SEC_MS_GEC_VERSION = '1-143.0.3650.96';
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
/** 合成超时：音色池已实测剔除死音色，正常几秒内返回；超时尽快转系统兜底 */
const SYNTH_TIMEOUT_MS = 12_000;
const AUDIO_MARKER = 'Path:audio\r\n';

/** 生成 Sec-MS-GEC 令牌（与 msedge-tts 1.x 算法一致） */
async function generateSecMsGec(): Promise<string> {
  const ticks = Math.floor(Date.now() / 1000) + 11644473600;
  const rounded = ticks - (ticks % 300);
  const windowsTicks = rounded * 10000000;
  const data = new TextEncoder().encode(`${windowsTicks}${TRUSTED_CLIENT_TOKEN}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SSML 文本处理：先剥离 XML 1.0 非法控制字符（避免 SSML 解析失败被服务器拒单），再转义特殊符号 */
function escapeXml(s: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface EdgeTTSSynthOptions {
  voice: string;
  rate?: string; // '+0%'
  pitch?: string; // '+0Hz'
  volume?: string; // '+0%'
}

/**
 * 合成一段文本，返回 MP3 音频（ArrayBuffer）。
 * @throws 网络错误 / 超时 / 服务端拒绝
 */
export async function edgeTTSSynthesize(text: string, options: EdgeTTSSynthOptions): Promise<ArrayBuffer> {
  const { voice, rate = '+0%', pitch = '+0Hz', volume = '+0%' } = options;
  if (typeof WebSocket === 'undefined') throw new Error('WebSocket 不可用');
  if (typeof crypto?.subtle === 'undefined') throw new Error('Web Crypto 不可用');

  const secMsGec = await generateSecMsGec();
  const url = `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${crypto.randomUUID()}`;

  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  const chunks: Uint8Array[] = [];
  const markerBytes = new TextEncoder().encode(AUDIO_MARKER);

  return new Promise<ArrayBuffer>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (err?: Error, out?: Uint8Array) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(out!.buffer as ArrayBuffer);
    };

    timer = setTimeout(() => finish(new Error('合成超时')), SYNTH_TIMEOUT_MS);

    ws.onopen = () => {
      try {
        ws.send(
          `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
            JSON.stringify({
              context: {
                synthesis: {
                  audio: {
                    metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                    outputFormat: OUTPUT_FORMAT,
                  },
                },
              },
            }),
        );
        const locale = (voice.match(/\w{2}-\w{2}/) ?? ['zh-CN'])[0];
        const ssml =
          `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">` +
          `<voice name="${voice}"><prosody pitch="${pitch}" rate="${rate}" volume="${volume}">${escapeXml(text)}</prosody></voice>` +
          `</speak>`;
        ws.send(`X-RequestId:${randomHex(16)}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` + ssml);
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      // 文本帧：turn.end 表示合成完毕
      if (typeof ev.data === 'string') {
        if (ev.data.includes('Path:turn.end')) {
          const total = chunks.reduce((n, c) => n + c.byteLength, 0);
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            out.set(c, off);
            off += c.byteLength;
          }
          finish(undefined, out);
        }
        return;
      }
      // 二进制帧：定位 "Path:audio\r\n"，其后为 MP3 分片
      const buf = new Uint8Array(ev.data as ArrayBuffer);
      let idx = -1;
      outer: for (let i = 0; i + markerBytes.length <= buf.length; i++) {
        for (let j = 0; j < markerBytes.length; j++) {
          if (buf[i + j] !== markerBytes[j]) continue outer;
        }
        idx = i;
        break;
      }
      if (idx >= 0) {
        chunks.push(buf.slice(idx + markerBytes.length));
      }
    };

    ws.onerror = () => finish(new Error('连接失败'));
    ws.onclose = () => {
      if (!settled) finish(new Error('连接被关闭'));
    };
  });
}
