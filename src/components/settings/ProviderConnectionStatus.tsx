import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { subscribeProviderConfig } from '../../lib/ai/provider-config';
import type { ProviderId } from '../../lib/ai/provider-registry';
import { CONNECTION_CHECK_EVENT, readConnectionCheck, type ConnectionCheckView } from '../../lib/ai/connection-check';

export function ProviderConnectionStatus({ provider, model, active = true }: { provider: ProviderId; model: string; active?: boolean }) {
  const owner = useAuthStore(s => s.userId), accountKey = useAuthStore(s => s.apiKey), gatewayToken = useAuthStore(s => s.gatewayRefreshToken);
  const identity = JSON.stringify([owner, provider, model]);
  const [view, setView] = useState<{ identity: string; check: ConnectionCheckView }>();
  useEffect(() => {
    if (!active || !owner) return;
    let alive = true, sequence = 0;
    const refresh = () => {
      const current = ++sequence;
      void readConnectionCheck(owner, provider, model).then(check => {
        if (alive && current === sequence && useAuthStore.getState().userId === owner) setView({ identity, check });
      }).catch(() => { if (alive && current === sequence) setView({ identity, check: { status: 'untested' } }); });
    };
    refresh();
    const unsubscribe = subscribeProviderConfig(refresh);
    const events = [CONNECTION_CHECK_EVENT, 'vg:provider-credentials-changed', 'storage', 'focus'];
    events.forEach(event => window.addEventListener(event, refresh));
    // Expiry is a display check only. Opening/revisiting never calls a provider.
    const timer = window.setInterval(refresh, 60_000);
    return () => { alive = false; sequence++; unsubscribe(); events.forEach(event => window.removeEventListener(event, refresh)); clearInterval(timer); };
  }, [owner, accountKey, gatewayToken, provider, model, identity, active]);
  const check = view?.identity === identity ? view.check : undefined;
  const labels: Record<ConnectionCheckView['status'], string> = {
    unconfigured: '配置尚未就绪', untested: '当前模型尚未检测', changed: '连接配置已变化，请重新检测', checking: '正在检测已保存的连接…',
    success: check?.scope === 'gateway' ? '最近检测：网关可达' : check?.scope === 'catalog' ? '最近检测成功：模型列表可访问' : '最近检测成功：模型已响应',
    failure: '最近检测失败，请重试', expired: '上次检测已超过 24 小时，请重新检测',
  };
  return <div className="mt-3 text-sm leading-6 text-sub" data-connection-check={check?.status ?? 'loading'} role="status" aria-live="polite" aria-busy={check?.status === 'checking'}>
    <p>{check ? labels[check.status] : '正在读取本机检测记录…'}</p>
    {check?.at && <p>最近检测：<time dateTime={new Date(check.at).toISOString()}>{new Date(check.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></p>}
    {check?.status === 'success' && check.scope !== 'model' && <p>{check.scope === 'gateway' ? '网关可达不代表具体模型权限已验证。' : '模型列表可访问不代表所有模型都能生成回复。'}</p>}
  </div>;
}
