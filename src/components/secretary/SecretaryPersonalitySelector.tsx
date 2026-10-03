import { useId, useState } from 'react';
import { SECRETARY_PERSONALITIES, SECRETARY_PERSONALITY_SCENARIOS, secretaryPersonality, type SecretaryPersonality, type SecretaryPersonalityScenario } from '../../lib/secretary/personality';

export function SecretaryPersonalitySelector({ value, preferences, onChange, onPreferencesChange, disabled = false, personalityLocked = false }: {
  value: SecretaryPersonality; preferences: string; onChange: (value: SecretaryPersonality) => void;
  onPreferencesChange: (value: string) => void; disabled?: boolean; personalityLocked?: boolean;
}) {
  const groupId = useId();
  const [scenario, setScenario] = useState<SecretaryPersonalityScenario>('work');
  const selected = SECRETARY_PERSONALITIES.find(option => option.id === secretaryPersonality(value))!;
  const scene = SECRETARY_PERSONALITY_SCENARIOS.find(option => option.id === scenario)!;
  return <fieldset disabled={disabled} className="vg-secretary-personality min-w-0 space-y-3">
    <legend className="mb-2 text-sm font-medium text-ink">{personalityLocked ? '这位助理的性格' : '你希望 TA 是什么性格？'}</legend>
    {personalityLocked ? <div className="rounded-xl border border-gene-purple/30 bg-gene-purple/5 p-3"><p className="text-sm font-medium text-ink">{selected.label} · {selected.archetype}</p><p className="mt-1 text-xs leading-relaxed text-sub">{selected.description}</p></div> :
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {SECRETARY_PERSONALITIES.map((option, index) => <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 ${value === option.id ? 'border-gene-purple/50 bg-gene-purple/10' : 'border-line bg-surface'} ${disabled ? 'opacity-60' : ''}`}>
        <input type="radio" name={groupId} aria-label={option.label} checked={value === option.id} onChange={() => onChange(option.id)} className="mt-1 accent-gene-purple" />
        <span className="min-w-0"><span className="block text-sm font-medium text-ink"><small className="mr-2 text-xs text-sub">{index + 1}档</small>{option.label}</span><span className="mt-1 block text-sm text-gene-purple">{option.archetype}</span><span className="mt-1 block text-xs leading-relaxed text-sub">{option.description}</span></span>
      </label>)}
    </div>}
    <div className="vg-secretary-personality-example rounded-xl border border-line p-3 text-xs leading-relaxed">
      <p className="text-sub">性格示例 · {selected.archetype}</p>
      <div role="group" aria-label="性格示例场景" className="my-2 flex flex-wrap gap-2">
        {SECRETARY_PERSONALITY_SCENARIOS.map(option => <button key={option.id} type="button" aria-pressed={scenario === option.id} onClick={() => setScenario(option.id)} className={`rounded-lg border px-2 py-1.5 ${scenario === option.id ? 'border-gene-purple/50 bg-gene-purple/10 text-ink' : 'border-line text-sub'}`}>{option.label}</button>)}
      </div>
      <p className="text-sub">假设：{scene.context}</p><p aria-live="polite" className="mt-1 text-sm text-ink">{selected.examples[scenario]}</p>
    </div>
    <label className="block text-xs text-sub">补充偏好（可选）
      <textarea aria-label="助理补充偏好" value={preferences} onChange={e => onPreferencesChange(e.target.value)} maxLength={300} rows={2} placeholder="例如：少用表情，回复简短，称呼我小林" className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-gene-purple" />
    </label>
    <p className="text-xs leading-relaxed text-sub">每次聘用时选择名字和性格。想换一种相处方式，可以解雇后重新聘用，记录会保留。称呼、回复长度等偏好随时可调。</p>
  </fieldset>;
}
