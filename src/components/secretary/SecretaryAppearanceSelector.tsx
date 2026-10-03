import { useId } from 'react';
import { avatarImageSrc } from '../../lib/avatar';
import { secretaryAvatar, type SecretaryAppearance } from '../../lib/secretary/appearance';
import { SECRETARY_PERSONALITIES, type SecretaryPersonality } from '../../lib/secretary/personality';

export function SecretaryAppearanceSelector({ personality, value, onChange, disabled = false, customAvatar }: {
  personality: SecretaryPersonality; value?: SecretaryAppearance; onChange: (value: SecretaryAppearance) => void; disabled?: boolean; customAvatar?: string;
}) {
  const group = useId();
  const profile = SECRETARY_PERSONALITIES.find(p => p.id === personality)!;
  return <fieldset disabled={disabled} className="vg-secretary-appearance min-w-0 space-y-3">
    <legend className="mb-2 text-sm font-medium text-ink">选择 TA 的形象</legend>
    <p className="text-xs text-sub">{profile.archetype} · 二次元 AI 拟人形象。形象随时可换，办事能力相同。</p>
    {customAvatar && !value && <p className="text-xs text-life-cyan">当前使用自定义头像；选择下方形象后替换。</p>}
    <div className="grid grid-cols-2 gap-3">
      {(['female', 'male'] as const).map(appearance => <label key={appearance} className={`min-w-0 cursor-pointer overflow-hidden rounded-2xl border bg-surface ${value === appearance ? 'border-gene-purple/60 ring-2 ring-gene-purple/15' : 'border-line'}`}>
        <img src={avatarImageSrc(secretaryAvatar(personality, appearance))} alt={`${profile.archetype} · ${appearance === 'female' ? '女性' : '男性'}形象`} className="aspect-square w-full object-cover" loading="lazy" />
        <span className="flex min-h-11 items-center justify-center gap-2 text-sm text-ink"><input type="radio" name={group} aria-label={appearance === 'female' ? '女性形象' : '男性形象'} checked={value === appearance} onChange={() => onChange(appearance)} className="accent-gene-purple" />{appearance === 'female' ? '女性形象' : '男性形象'}</span>
      </label>)}
    </div>
  </fieldset>;
}
