import { useId, useState } from 'react';
import { LLM_PROVIDERS, normalizeModelId, type LLMModel, type ProviderId } from '../../lib/ai/llm';

export function modelChoiceKey(provider: string, model: string) {
  return JSON.stringify([provider, normalizeModelId(model, provider)]);
}

export function ModelList({ models, ready, value, onChange, mode = 'radio', includeDefault, defaultLabel = '系统默认', defaultDetail = '使用软件的默认模型', defaultUnavailable = false }: {
  models: LLMModel[];
  ready: Partial<Record<ProviderId, boolean>>;
  value?: { provider: string; model: string } | null;
  onChange: (model: { provider: string; model: string } | null) => void;
  mode?: 'radio' | 'button';
  includeDefault?: boolean;
  defaultLabel?: string;
  defaultDetail?: string;
  defaultUnavailable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const groupName = useId();
  const search = query.trim().toLocaleLowerCase();
  const filtered = models.filter(model => `${model.label} ${model.id} ${LLM_PROVIDERS[model.provider].name}`.toLocaleLowerCase().includes(search));
  const active = value ? modelChoiceKey(value.provider, value.model) : '__default__';
  const items = [
    ...(includeDefault && (!search || `${defaultLabel} ${defaultDetail}`.toLocaleLowerCase().includes(search)) ? [{ key: '__default__', label: defaultLabel, detail: defaultDetail, model: null, available: !defaultUnavailable }] : []),
    ...filtered.map(model => ({ key: modelChoiceKey(model.provider, model.id), label: model.label, detail: LLM_PROVIDERS[model.provider].name, model, available: Boolean(ready[model.provider]) })),
  ];
  return <div className="vg-model-list">
    <label className="vg-model-search">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input type="search" aria-label="搜索模型" placeholder="搜索模型或服务商" value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    <div className="vg-model-options" role={mode === 'radio' ? 'radiogroup' : undefined} aria-label={mode === 'radio' ? '默认对话模型' : '可用对话模型'}>
      {items.map(item => {
        const copy = <><span className="vg-model-option-copy"><strong>{item.label}</strong><small>{item.detail}</small>{item.model && <code>{item.model.id}</code>}</span><span className="vg-model-option-tags">{item.model?.vision && <span>图片</span>}{!item.available && <span className="vg-model-missing">未配置</span>}</span></>;
        return mode === 'radio' ? <label key={item.key} className={`vg-model-option ${active === item.key ? 'is-selected' : ''}`}>
          {copy}<input type="radio" name={groupName} checked={active === item.key} onChange={() => onChange(item.model ? { provider: item.model.provider, model: item.model.id } : null)} />
        </label> : <button type="button" key={item.key} className={`vg-model-option ${active === item.key ? 'is-selected' : ''}`} disabled={!item.available} onClick={() => onChange(item.model ? { provider: item.model.provider, model: item.model.id } : null)}>
          {copy}<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m9 5 7 7-7 7"/></svg>
        </button>;
      })}
    </div>
    {items.length === 0 && <p className="vg-model-empty">没有找到匹配的模型。可在服务商设置中填写准确的模型 ID。</p>}
  </div>;
}
