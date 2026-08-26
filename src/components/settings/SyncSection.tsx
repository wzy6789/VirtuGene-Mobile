import { useState } from 'react';
import { useSyncStore } from '../../store/sync-store';

/**
 * 局域网同步（手机端）：作为 HTTP 客户端直连桌面端同步服务。
 * 桌面端实现协议见 MOBILE.md（GET /sync/export、POST /sync/import，带 CORS）。
 */
export function SyncSection() {
  const { clientStatus, clientError, clientBusy, pullFromDesktop, pushToDesktop } = useSyncStore();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('46789');
  /** 本机空 IP 提示（避免用户点了没反应） */
  const [emptyHint, setEmptyHint] = useState(false);

  const inputCls =
    'w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors';

  /** 校验 IP 后触发动作；IP 为空给出可见提示，而不是静默忽略 */
  const guard = (fn: (host: string, port: number) => void) => {
    if (!host.trim()) {
      setEmptyHint(true);
      setTimeout(() => setEmptyHint(false), 2500);
      return;
    }
    setEmptyHint(false);
    fn(host.trim(), Number(port || '46789'));
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-ink mb-3">🧬 局域网同步（桌面互联）</h3>
      <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <input
            value={host}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHost(v);
              // 粘贴完整地址（含 http:// 或端口）时自动拆出 IP 与端口
              const m = v.match(/^https?:\/\/([^/:]+)(?::(\d+))?/i);
              if (m) {
                setHost(m[1]);
                if (m[2]) setPort(m[2]);
              }
            }}
            placeholder="桌面端 IP，如 192.168.1.8"
            inputMode="decimal"
            className={inputCls}
          />
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder="端口"
            inputMode="numeric"
            className={inputCls}
          />
        </div>

        <p className="text-[11px] text-gray-500 -mt-1">
          直接粘贴桌面端显示的完整地址（如 http://192.168.1.8:46789）也可以，会自动提取 IP 与端口。
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => guard(pullFromDesktop)}
            disabled={clientBusy}
            className="flex-1 px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] disabled:opacity-50 shadow-[0_2px_12px_rgba(108,92,231,0.35)] transition-all"
          >
            {clientBusy ? '连接中…' : '拉取桌面数据'}
          </button>
          <button
            onClick={() => guard(pushToDesktop)}
            disabled={clientBusy}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-life-cyan bg-life-cyan/10 border border-life-cyan/30 hover:bg-life-cyan/20 disabled:opacity-50 transition-all"
          >
            {clientBusy ? '连接中…' : '推送本机数据'}
          </button>
        </div>

        {/* 明确的状态反馈：忙 = 青色脉冲；成功 = 青色；失败 = 红底红字 */}
        {clientBusy && <p className="text-xs text-life-cyan animate-pulse">正在连接桌面端…</p>}
        {emptyHint && <p className="text-xs text-amber-500">⚠️ 请先填写桌面端 IP 地址</p>}
        {clientStatus && !clientBusy && (
          <p className={`text-xs break-all px-3 py-2 rounded-lg ${clientError ? 'bg-red-500/10 text-red-400' : 'bg-life-cyan/10 text-life-cyan'}`}>
            {clientStatus}
          </p>
        )}

        <p className="text-[11px] text-gray-500">
          先在桌面端设置中开启「局域网同步」，并确保手机与电脑连接同一 Wi-Fi。互传角色、对话与日记，不含账号与 API Key。
        </p>
      </div>
    </div>
  );
}
