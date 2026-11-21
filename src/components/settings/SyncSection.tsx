import { useState } from 'react';
import { useSyncStore } from '../../store/sync-store';
import { SettingsField } from './SettingsUI';
import { FeedbackNotice } from '../ui/FeedbackNotice';

/**
 * 局域网同步（手机端）：作为 HTTP 客户端直连桌面端同步服务。
 * 桌面端实现协议见 MOBILE.md（GET /sync/export、POST /sync/import，带 CORS）。
 */
export function SyncSection() {
  const { clientStatus, clientError, clientBusy, pullFromDesktop, pushToDesktop } = useSyncStore();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('46789');
  const [invalid, setInvalid] = useState<'host' | 'port' | null>(null);

  /** 校验 IP 后触发动作；IP 为空给出可见提示，而不是静默忽略 */
  const guard = (fn: (host: string, port: number) => void) => {
    if (clientBusy) return;
    if (!host.trim()) {
      setInvalid('host');
      return;
    }
    const parsed = Number(port || '46789');
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) { setInvalid('port'); return; }
    setInvalid(null);
    fn(host.trim(), parsed);
  };

  return (
    <div>
      <div className="vg-settings-form space-y-4" aria-busy={clientBusy}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsField label="桌面地址" aria-invalid={invalid === 'host'} disabled={clientBusy}
            value={host}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHost(v);
              setInvalid(null);
              // 粘贴完整地址（含 http:// 或端口）时自动拆出 IP 与端口
              const m = v.match(/^https?:\/\/([^/:]+)(?::(\d+))?/i);
              if (m) {
                setHost(m[1]);
                if (m[2]) setPort(m[2]);
              }
            }}
            inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          />
          <SettingsField label="端口" aria-invalid={invalid === 'port'} disabled={clientBusy}
            value={port}
            onChange={(e) => { setPort(e.target.value.replace(/\D/g, '').slice(0, 5)); setInvalid(null); }}
            inputMode="numeric"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => guard(pullFromDesktop)}
            disabled={clientBusy}
            className="vg-button vg-button-primary"
          >
            拉取桌面数据
          </button>
          <button
            onClick={() => guard(pushToDesktop)}
            disabled={clientBusy}
            className="vg-button vg-button-secondary"
          >
            推送本机数据
          </button>
        </div>

        {clientBusy && <FeedbackNotice message={clientStatus || '正在连接桌面端…'} />}
        {invalid && <FeedbackNotice message={invalid === 'host' ? '请先填写桌面地址。' : '端口需要在 1–65535 之间。'} tone="error" />}
        {clientStatus && !clientBusy && (
          <FeedbackNotice message={clientStatus} tone={clientError ? 'error' : 'success'} />
        )}

        <p className="text-xs leading-6 text-sub">
          桌面开启「局域网同步」，两端连接同一 Wi-Fi；互传角色、对话与日记，不含账号和 API Key。
        </p>
      </div>
    </div>
  );
}
