import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { getAvailableModels, getProviderKey, LLM_PROVIDERS, type ProviderId } from '../../lib/ai/llm';
import { getProviderConfig, providerRequiresKey, subscribeProviderConfig } from '../../lib/ai/provider-config';
import { hasAiGatewayAccess } from '../../lib/ai/gateway';

const KEY_CHANGE_EVENT = 'vg:provider-credentials-changed';

/** Credentials remain outside React state; only readiness is exposed to the UI. */
export function notifyProviderCredentialsChanged() {
  window.dispatchEvent(new Event(KEY_CHANGE_EVENT));
}

export function useModelCatalog() {
  const owner = useAuthStore(s => s.userId);
  const accountKey = useAuthStore(s => s.apiKey);
  const gatewayToken = useAuthStore(s => s.gatewayAccessToken);
  const [revision, setRevision] = useState(0);
  const [readiness, setReadiness] = useState<{ owner: string | null; loading: boolean; ready: Partial<Record<ProviderId, boolean>> }>({ owner, loading: true, ready: {} });

  useEffect(() => {
    const changed = () => setRevision(value => value + 1);
    const unsubscribe = subscribeProviderConfig(changed);
    window.addEventListener(KEY_CHANGE_EVENT, changed);
    window.addEventListener('storage', changed);
    return () => {
      unsubscribe();
      window.removeEventListener(KEY_CHANGE_EVENT, changed);
      window.removeEventListener('storage', changed);
    };
  }, []);

  useEffect(() => {
    let live = true;
    setReadiness({ owner, loading: true, ready: {} });
    void Promise.all((Object.keys(LLM_PROVIDERS) as ProviderId[]).map(async provider => {
      const config = getProviderConfig(provider);
      const ready = config.enabled !== false && (
        (!providerRequiresKey(provider, config.baseUrl) && config.models.length > 0)
        || (provider === 'deepseek' && hasAiGatewayAccess())
        || Boolean(await getProviderKey(provider))
      );
      return [provider, ready] as const;
    })).then(entries => {
      if (live && useAuthStore.getState().userId === owner) setReadiness({ owner, loading: false, ready: Object.fromEntries(entries) });
    }).catch(() => {
      if (live && useAuthStore.getState().userId === owner) setReadiness({ owner, loading: false, ready: {} });
    });
    return () => { live = false; };
  }, [owner, accountKey, gatewayToken, revision]);

  return {
    owner,
    loading: readiness.owner !== owner || readiness.loading,
    ready: readiness.owner === owner ? readiness.ready : {},
    models: getAvailableModels(),
    revision,
  };
}
