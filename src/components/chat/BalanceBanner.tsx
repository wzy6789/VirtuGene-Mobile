import { ipc } from '../../lib/ipc-client';

export type ChatError = 'auth:invalid_key' | 'billing:insufficient' | 'rate:limited' | 'server:error' | 'timeout' | null;

const ERROR_MAP: Record<string, { text: string; action?: string; link?: string }> = {
  'auth:invalid_key': {
    text: '基因序列验证失败，请检查 API Key',
    action: '前往设置',
  },
  'billing:insufficient': {
    text: '⚠️ DeepSeek 账户余额不足，请前往平台充值后继续对话。',
    action: '前往平台充值',
    link: 'https://platform.deepseek.com/api_keys',
  },
  'rate:limited': {
    text: '请求过于频繁，请稍后重试',
  },
  'server:error': {
    text: '基因链接中断，请重试',
  },
  'timeout': {
    text: '基因链接超时，请重试',
  },
};

interface Props {
  error: ChatError;
}

export function BalanceBanner({ error }: Props) {
  if (!error) return null;

  const info = ERROR_MAP[error] ?? ERROR_MAP['server:error'];

  return (
    <div className="mx-4 mb-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-between text-sm">
      <span className="text-red-400 text-xs">{info.text}</span>
      {info.action && (
        <button
          onClick={() => {
            if (info.link) {
              ipc.shell.open(info.link);
            }
          }}
          className="shrink-0 ml-3 text-xs text-life-cyan hover:underline"
        >
          {info.action}
        </button>
      )}
    </div>
  );
}
