/**
 * 移动端 / 纯 Web 环境（Capacitor WebView、浏览器）的 VirtuGeneAPI 实现。
 *
 * 非 Electron 时由 ipc-client 选用本实现：
 * - AI 能力直接 fetch DeepSeek（API Key 只存在本机内存 store，不经过任何中间服务）
 * - 文件系统能力降级：TXT / Markdown / JSON 走浏览器下载，DOCX / PDF 导出暂不支持
 * - Electron 专属能力（窗口控制、自动更新、系统通知）为无害空操作
 *
 * 说明：手机版完全自包含 —— AI 服务实现复制自桌面端 electron/services 的纯函数版本，
 * 存放在 src/lib/ai/ 下，不依赖、也不修改任何桌面端代码。
 */
import { validateApiKey, sendMessage } from './ai/deepseek';
import { generateCharacterPrompt } from './ai/character-generator';
import { duckDuckGoSearch } from './ai/web-search';
import { generateProactiveMessage } from './ai/proactive-chat';
import { extractMemories } from './ai/memory-consolidator';
import { analyzeEmotion } from './ai/emotion-analyzer';
import { consolidateContext } from './ai/context-consolidator';
import { summarizeContext } from './ai/context-summarizer';
import { diaryAssist } from './ai/diary-assistant';

/** 统一错误码映射（与桌面端 IPC 层一致） */
function toError(err: unknown): string {
  const msg = (err as Error)?.message;
  if (
    typeof msg === 'string' &&
    ['auth:invalid_key', 'billing:insufficient', 'rate:limited', 'server:error', 'timeout'].includes(msg)
  ) {
    return msg;
  }
  return 'server:error';
}

/** 触发浏览器/WebView 下载（Android WebView 会转交系统下载器） */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const webApi: VirtuGeneAPI = {
  key: {
    validate: (apiKey) => validateApiKey(apiKey),
  },

  chat: {
    send: async (params) => {
      try {
        const r = await sendMessage(params);
        return { content: r.content, truncated: r.truncated, degraded: r.degraded };
      } catch (err) {
        return { error: toError(err) };
      }
    },
  },

  character: {
    generate: async (params, onProgress) => {
      const send = (step: string, message: string, progress: number) => {
        try {
          onProgress?.(step, message, progress);
        } catch {
          /* ignore */
        }
      };
      const count = Math.max(1, Math.min(3, params.count ?? 1));
      try {
        let webContext: string | undefined;
        if (params.enableWebSearch) {
          send('search', '正在扫描基因库检索相关资料...', 0.08);
          webContext = await duckDuckGoSearch(params.characterName);
        }
        const base = params.enableWebSearch ? 0.16 : 0.05;
        if (count === 1) {
          send('generate', '正在合成数字灵魂序列...', base);
          const result = await generateCharacterPrompt({
            apiKey: params.apiKey,
            characterName: params.characterName,
            fields: params.fields,
            webContext,
            documentContext: params.documentContext,
          });
          send('generate', '基因序列合成完成', 1);
          return { candidates: [result] };
        }
        send('generate', `正在合成候选基因序列 (0/${count})...`, base);
        let done = 0;
        const candidates = await Promise.all(
          Array.from({ length: count }, async () => {
            const result = await generateCharacterPrompt({
              apiKey: params.apiKey,
              characterName: params.characterName,
              fields: params.fields,
              webContext,
              documentContext: params.documentContext,
            });
            done += 1;
            send('generate', `已合成候选基因序列 (${done}/${count})...`, base + (1 - base) * (done / count));
            return result;
          }),
        );
        return { candidates };
      } catch (err) {
        return { error: toError(err) };
      }
    },
  },

  file: {
    parse: async (file: File) => {
      const name = (file.name || '').toLowerCase();
      try {
        if (name.endsWith('.docx') || name.endsWith('.pdf')) {
          return { error: '手机版暂不支持解析该格式，请使用桌面版 VirtuGene 生成角色后，通过局域网同步过来' };
        }
        const text = await file.text();
        return { text: text.slice(0, 200_000) };
      } catch {
        return { error: '文件解析失败' };
      }
    },
    parserReady: async () => ({ ready: false }),
    downloadParser: async () => ({ error: '手机版无需下载解析器' }),
  },

  proactive: {
    generate: async (params) => {
      try {
        return { content: await generateProactiveMessage(params) };
      } catch (err) {
        return { error: toError(err) };
      }
    },
  },

  memory: {
    extract: async (params) => {
      try {
        return await extractMemories(params);
      } catch (err) {
        return { error: toError(err) };
      }
    },
  },

  emotion: {
    analyze: async (params) => {
      try {
        return await analyzeEmotion(params);
      } catch (err) {
        return { error: toError(err) };
      }
    },
  },

  context: {
    settle: async (params) => {
      try {
        return await consolidateContext(params);
      } catch (err) {
        return { error: toError(err) };
      }
    },
    summarize: async (params) => {
      try {
        return await summarizeContext(params);
      } catch (err) {
        return { error: toError(err) };
      }
    },
  },

  diary: {
    assist: async (params) => {
      try {
        return await diaryAssist(params);
      } catch (err) {
        return { error: toError(err) };
      }
    },
    exportTxt: async (entries) => {
      const text = entries
        .map((e) => `${e.title}\n${e.date}\n\n${e.content}`)
        .join('\n\n' + '─'.repeat(24) + '\n\n');
      downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `VirtuGene-日记-${new Date().toISOString().slice(0, 10)}.txt`);
      return { ok: true };
    },
    exportDocx: async () => ({ ok: false, error: '手机版暂不支持导出 Word，请使用桌面版' }),
    exportPdf: async () => ({ ok: false, error: '手机版暂不支持导出 PDF，请使用桌面版' }),
    exportJson: async (diaries) => {
      const payload = { app: 'VirtuGene', kind: 'diary-backup', exportedAt: new Date().toISOString(), diaries };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), `VirtuGene-日记备份-${new Date().toISOString().slice(0, 10)}.json`);
      return { ok: true };
    },
    importJson: () =>
      new Promise<{ ok?: boolean; canceled?: boolean; diaries?: unknown[]; error?: string }>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) {
            resolve({ canceled: true });
            return;
          }
          try {
            const parsed = JSON.parse(await f.text());
            const list = Array.isArray(parsed) ? parsed : (parsed?.diaries ?? []);
            resolve({ ok: true, diaries: list });
          } catch {
            resolve({ ok: false, error: '文件解析失败，请确认是 VirtuGene 的日记备份' });
          }
        };
        input.click();
      }),
    exportMarkdown: async (diaries) => {
      const lines: string[] = ['# VirtuGene 我的手账', '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
      for (const d of [...diaries].sort((a, b) => a.date.localeCompare(b.date))) {
        lines.push(`## ${d.date}${d.title ? ' · ' + d.title : ''}`, '');
        if (d.tags && d.tags.length > 0) lines.push(`> 标签：${d.tags.map((t) => '#' + t).join(' ')}`, '');
        lines.push(d.content, '', '---', '');
      }
      downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), `VirtuGene-日记全量-${new Date().toISOString().slice(0, 10)}.md`);
      return { ok: true };
    },
  },

  shell: {
    open: async (url) => {
      try {
        // Capacitor Android 会拦截 _system 目标并唤起系统浏览器
        const w = window.open(url, '_system');
        if (!w) window.open(url, '_blank');
        return true;
      } catch {
        try {
          window.open(url, '_blank');
        } catch {
          /* ignore */
        }
        return false;
      }
    },
  },

  window: {
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    setSize: async () => false,
  },

  app: {
    getVersion: async () => __APP_VERSION__,
    notify: async () => false,
  },

  clipboard: {
    writeText: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          return true;
        } catch {
          return false;
        }
      }
    },
  },

  update: {
    check: async () => ({ error: '手机版通过应用商店更新，无需检查' }),
    download: async () => ({ error: '手机版不支持自动下载更新' }),
    install: async () => ({ error: '手机版不支持自动安装更新' }),
    onStatus: () => () => {},
  },
};
