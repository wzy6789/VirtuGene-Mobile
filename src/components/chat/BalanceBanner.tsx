import { ipc } from '../../lib/ipc-client';
import {lazy, Suspense, useState} from 'react';
const SettingsPanel=lazy(()=>import('../settings/SettingsPanel').then(module=>({default:module.SettingsPanel})));

export type ChatError = 'auth:invalid_key' | 'billing:insufficient' | 'rate:limited' | 'server:error' | 'timeout' | null;

const ERROR_MAP: Record<string, { text: string; action?: string; link?: string }> = {
  'auth:invalid_key': {
    text: '连接验证失败，请检查 API 密钥',
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
    text: '这条消息暂时没收到回复，点消息旁的感叹号重试',
  },
  'timeout': {
    text: '等待回复超时，消息已保留，可点感叹号重试',
  },
};

interface Props {
  error: ChatError;
}

export function BalanceBanner({ error }: Props) {
  const [settingsOpen,setSettingsOpen]=useState(false);
  if (!error) return null;

  const info = ERROR_MAP[error] ?? ERROR_MAP['server:error'];

  return (
    <><div role="alert" className="vg-chat-error-notice">
      <span>{info.text}</span>
      {info.action && (
        <button
          onClick={() => {
            if (info.link) {
              ipc.shell.open(info.link);
            } else setSettingsOpen(true);
          }}
          className="shrink-0"
        >
          {info.action}
        </button>
      )}
    </div>{settingsOpen&&<Suspense fallback={null}><SettingsPanel open initialPage="connection" onClose={()=>setSettingsOpen(false)}/></Suspense>}</>
  );
}
