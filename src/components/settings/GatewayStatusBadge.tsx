import { useCallback, useEffect, useRef, useState } from 'react';
import { checkGatewayHealth, type GatewayHealth, isAiGatewayConfigured } from '../../lib/ai/gateway-session';
import { Icon } from '../ui/Icon';

const LABELS: Record<GatewayHealth | 'checking', string> = {
  connected: '网关服务可达',
  offline: '网关暂不可达',
  unconfigured: '未使用内置网关',
  checking: '正在检测网关…',
};

export function GatewayStatusBadge({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<GatewayHealth | 'checking'>(isAiGatewayConfigured() ? 'checking' : 'unconfigured');
  const alive = useRef(false);
  const pending = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!alive.current || document.visibilityState === 'hidden' || pending.current || !isAiGatewayConfigured()) return;
    const controller = new AbortController();
    pending.current = controller;
    setStatus('checking');
    try {
      const next = await checkGatewayHealth(controller.signal);
      if (alive.current && pending.current === controller && !controller.signal.aborted) setStatus(next);
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const visibility = () => {
      if (document.visibilityState === 'hidden') { pending.current?.abort(); pending.current = null; }
      else void refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { alive.current = false; pending.current?.abort(); pending.current = null; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [refresh]);

  const color = status === 'connected' ? 'text-emerald-400' : status === 'offline' ? 'text-amber-400' : 'text-sub';
  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={status === 'checking' || status === 'unconfigured'}
      aria-busy={status === 'checking'}
      title={status === 'unconfigured' ? '当前未配置内置网关，可使用服务商直连' : '重新检测内置网关可达性'}
      className={`vg-gateway-status inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface text-sm text-sub transition-colors ${compact ? 'is-compact px-3 py-1' : 'w-full px-4 py-3'}`}
    >
      <Icon name="connection" className={color}/>
      <span role="status" aria-live="polite">{LABELS[status]}</span>
      {!compact && status !== 'unconfigured' && <Icon name="refresh" size={18} className="ml-auto"/>}
    </button>
  );
}
