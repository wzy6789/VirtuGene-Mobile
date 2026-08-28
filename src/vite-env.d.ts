/// <reference types="vite/client" />

/** 构建时由 vite.config.ts 注入的 package.json version */
declare const __APP_VERSION__: string;

type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available'; version?: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

interface VirtuGeneAPI {
  key: {
    validate: (apiKey: string) => Promise<{ valid: boolean; error?: string }>;
  };
  chat: {
    send: (params: {
      apiKey: string;
      systemPrompt: string;
      message: string;
      image?: string;
      history: { role: 'user' | 'assistant'; content: string; image?: string }[];
      retryHint?: string;
      temperature?: number;
    }) => Promise<{ content?: string; error?: string; truncated?: boolean; degraded?: boolean }>;
  };
  shell: {
    open: (url: string) => Promise<boolean>;
  };
  character: {
    generate: (
      params: {
        apiKey: string;
        characterName: string;
        fields: {
          description?: string;
          identity?: string;
          personality?: string;
          speechStyle?: string;
          speechExamples?: string;
          supplement?: string;
        };
        enableWebSearch: boolean;
        documentContext?: string;
        count?: number;
      },
      onProgress?: (step: string, message: string, progress: number) => void,
    ) => Promise<{
      candidates?: {
        tags: string[];
        signature: string;
        greeting: string;
        systemPrompt: string;
      }[];
      error?: string;
    }>;
  };
  file: {
    parse: (file: File) => Promise<{ text?: string; error?: string }>;
    parserReady: () => Promise<{ ready: boolean }>;
    downloadParser: () => Promise<{ ok?: boolean; error?: string }>;
  };
  proactive: {
    generate: (params: {
      apiKey: string;
      systemPrompt: string;
      characterName: string;
      lastMessages: { role: string; content: string }[];
      affinity?: number;
      mood?: number;
      lastMessageAt?: number;
    }) => Promise<{ content?: string; error?: string }>;
  };
  memory: {
    extract: (params: {
      apiKey: string;
      history: { role: string; content: string }[];
    }) => Promise<{ memories?: string[]; error?: string }>;
  };
  emotion: {
    analyze: (params: {
      apiKey: string;
      history: { role: string; content: string }[];
      characterName: string;
    }) => Promise<{
      dimensions?: { valence: number; arousal: number; intimacy: number; engagement: number; expressiveness: number; stability: number };
      dominantEmotion?: string;
      summary?: string;
      error?: string;
    }>;
  };
  context: {
    settle: (params: {
      apiKey: string;
      history: { role: string; content: string }[];
      characterName: string;
    }) => Promise<{
      memories?: string[];
      dimensions?: { valence: number; arousal: number; intimacy: number; engagement: number; expressiveness: number; stability: number };
      dominantEmotion?: string;
      userEmotion?: string;
      summary?: string;
      error?: string;
    }>;
    summarize: (params: {
      apiKey: string;
      history: { role: string; content: string }[];
    }) => Promise<{ summary?: string; error?: string }>;
  };
  diary: {
    assist: (params: {
      apiKey: string;
      mode: 'polish' | 'continue' | 'extract' | 'guide' | 'auto' | 'compile' | 'combine' | 'review' | 'annual' | 'recall' | 'persona' | 'insight' | 'note';
      text: string;
      context?: string;
    }) => Promise<{ text?: string; title?: string; tags?: string[]; persona?: { keywords: string[]; topics: string[]; emotion: string; summary: string }; error?: string }>;
    exportTxt: (entries: { title: string; date: string; content: string }[]) => Promise<{ ok?: boolean; canceled?: boolean; filePath?: string }>;
    exportDocx: (entries: { title: string; date: string; content: string }[]) => Promise<{ ok?: boolean; canceled?: boolean; filePath?: string }>;
    exportPdf: (html: string) => Promise<{ ok?: boolean; canceled?: boolean; filePath?: string }>;
    exportJson: (diaries: unknown[]) => Promise<{ ok?: boolean; canceled?: boolean; filePath?: string }>;
    importJson: () => Promise<{ ok?: boolean; canceled?: boolean; diaries?: unknown[]; error?: string }>;
    exportMarkdown: (diaries: { date: string; title: string; content: string; mood?: number; tags?: string[] }[]) => Promise<{ ok?: boolean; canceled?: boolean; filePath?: string }>;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    setSize: (width: number, height: number) => Promise<boolean>;
  };
  app: {
    getVersion: () => Promise<string>;
    notify: (title: string, body: string) => Promise<boolean>;
  };
  clipboard: {
    writeText: (text: string) => Promise<boolean>;
  };
  update: {
    check: () => Promise<{ version?: string | null; error?: string }>;
    download: () => Promise<{ ok?: boolean; error?: string }>;
    install: () => Promise<{ ok?: boolean; error?: string }>;
    onStatus: (callback: (status: UpdateStatus) => void) => () => void;
  };
}

interface Window {
  virtugene: VirtuGeneAPI;
}
