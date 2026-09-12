import { useEffect, useState } from 'react';
import { checkGatewayHealth, type GatewayHealth, isAiGatewayConfigured } from '../../lib/ai/gateway';

const LABELS: Record<GatewayHealth, string> = {
  connected: 'AI 连接正常',
  offline: 'AI 连接异常',
  unconfigured: '本地模式',
};

export function GatewayStatusBadge({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<GatewayHealth>(isAiGatewayConfigured() ? 'offline' : 'unconfigured');

  const refresh = () => { void checkGatewayHealth().then(setStatus); };
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const color = status === 'connected' ? 'bg-emerald-400' : status === 'unconfigured' ? 'bg-gray-400' : 'bg-amber-400';
  return (
    <button
      type="button"
      onClick={refresh}
      title="点击重新检测 AI 连接"
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/60 text-[10px] text-gray-500 hover:text-sub transition-colors ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${color} ${status === 'connected' ? 'shadow-[0_0_7px_rgba(52,211,153,0.8)]' : ''}`} />
      {LABELS[status]}
    </button>
  );
}
