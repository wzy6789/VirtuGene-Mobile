import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { breathe } from '../../lib/haptics';
import { Icon, type IconName } from '../ui/Icon';

const icons = {
  account: 'profile', appearance: 'moon', voice: 'mic', connection: 'connection',
  privacy: 'shield', data: 'database', about: 'info', world: 'spark',
  diary: 'diary', clock: 'clock', search: 'search', edit: 'edit',
} as const satisfies Record<string, IconName>;
export type SettingsIconName = keyof typeof icons;
export function SettingsIcon({ name }: { name: SettingsIconName }) {
  return <Icon name={icons[name]} size={20} />;
}
export function SettingsField({ label, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const generatedId = useId();
  const id = input.id ?? generatedId;
  return <div className="vg-settings-field"><label htmlFor={id}>{label}</label><input {...input} id={id} aria-describedby={[input['aria-describedby'], hint ? `${id}-hint` : undefined].filter(Boolean).join(' ') || undefined} />{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function SettingsOverview() {
  return <div className="vg-settings-overview"><p className="vg-settings-intro">调整声音、阅读、隐私与连接。</p></div>;
}
export function SettingsGroup({ title, scope, children }: { title: string; scope?: string; children: ReactNode }) {
  const id = useId();
  return <section className="vg-preference-group" aria-labelledby={id}><h3 id={id}><span className="vg-preference-heading">{title}</span>{scope && <span className="vg-preference-scope">{scope}</span>}</h3><div className="vg-preference-box">{children}</div></section>;
}
export function SettingsRow({ title, detail, value, icon, onClick, danger = false, showChevron = false }: { title: string; detail?: string; value?: string; icon?: SettingsIconName; onClick: () => void; danger?: boolean; showChevron?: boolean }) {
  return <button type="button" onClick={onClick} data-settings-icon={icon} className={`vg-preference-row ${danger ? 'is-danger' : ''}`}>{icon && <span className="vg-preference-icon"><SettingsIcon name={icon} /></span>}<span className="vg-preference-row-content"><span className="vg-preference-copy"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>{value && <span className="vg-preference-value">{value}</span>}</span>{showChevron && <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 5 7 7-7 7" /></svg>}</button>;
}
export function SettingsSwitch({ title, detail, checked, onChange, disabled, label }: { title: string; detail?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string }) {
  const id = useId();
  return <div className="vg-preference-row"><span className="vg-preference-copy"><strong>{title}</strong>{detail && <small id={id}>{detail}</small>}</span><button type="button" role="switch" aria-label={label ?? title} aria-describedby={detail ? id : undefined} aria-checked={checked} disabled={disabled} onClick={() => { onChange(!checked); breathe(); }} className="vg-preference-toggle"><span aria-hidden="true" /></button></div>;
}
export function SettingsChoices<T extends string | number>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; title: string; detail?: string }[]; onChange: (value: T) => void; disabled?: boolean }) {
  const name = useId();
  return <div className="vg-preference-choices" role="radiogroup" aria-label={label}>{options.map(option => <label key={option.value} className={`vg-preference-choice ${value === option.value ? 'is-selected' : ''}`}><span className="vg-preference-copy"><strong>{option.title}</strong>{option.detail && <small>{option.detail}</small>}</span><input type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} /></label>)}</div>;
}
