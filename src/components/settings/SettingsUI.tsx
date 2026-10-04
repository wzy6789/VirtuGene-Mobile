import { useId, type ReactNode } from 'react';
import { breathe } from '../../lib/haptics';

const icons = {
  account: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  appearance: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9',
  voice: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3 M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3',
  connection: 'M8 4v4 M16 4v4 M5 8h14v2a7 7 0 0 1-14 0V8 M12 17v5',
  privacy: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4 M8 12l3 3 5-6',
  data: 'M12 3c5 0 9 2 9 4s-4 4-9 4-9-2-9-4 4-4 9-4 M3 7v10c0 2 4 4 9 4s9-2 9-4V7 M3 12c0 2 4 4 9 4s9-2 9-4',
  about: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 11v6 M12 7v.1',
  world: 'M12 3 14 9 21 12 14 15 12 21 10 15 3 12 10 9 12 3',
  diary: 'M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4 M14 7a3 3 0 0 1 3-3h3v15h-3 M7 8h3 M7 12h3',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2',
  search: 'm16 16 4 4 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  edit: 'm15 4 5 5-11 11H4v-5L15 4 M12 7l5 5',
} as const;
export type SettingsIconName = keyof typeof icons;
export function SettingsIcon({ name }: { name: SettingsIconName }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name]} /></svg>;
}
export function SettingsOverview() {
  return <div className="vg-settings-overview">
    <div className="vg-settings-overview-copy"><span className="vg-settings-eyebrow">星域偏好</span><h3>让相处，更合心意</h3><p className="vg-settings-intro">按你的习惯，调整声音、阅读、隐私与连接。</p></div>
    <svg className="vg-settings-orbit" aria-hidden="true" width="76" height="76" viewBox="0 0 76 76" fill="none">
      <circle cx="38" cy="38" r="28" /><ellipse cx="38" cy="38" rx="35" ry="13" transform="rotate(-35 38 38)" />
      <path className="vg-settings-orbit-star" d="m38 24 3.5 10.5L52 38l-10.5 3.5L38 52l-3.5-10.5L24 38l10.5-3.5L38 24Z" />
      <circle className="vg-settings-orbit-point" cx="61" cy="22" r="2.5" />
    </svg>
  </div>;
}
export function SettingsGroup({ title, scope, children }: { title: string; scope?: string; children: ReactNode }) {
  const id = useId();
  return <section className="vg-preference-group" aria-labelledby={id}><h3 id={id}>{title}{scope && <span className="vg-preference-scope">{scope}</span>}</h3><div className="vg-preference-box">{children}</div></section>;
}
export function SettingsRow({ title, detail, value, icon, onClick, danger = false }: { title: string; detail?: string; value?: string; icon?: SettingsIconName; onClick: () => void; danger?: boolean }) {
  return <button type="button" onClick={onClick} data-settings-icon={icon} className={`vg-preference-row ${danger ? 'is-danger' : ''}`}>{icon && <span className="vg-preference-icon"><SettingsIcon name={icon} /></span>}<span className="vg-preference-copy"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>{value && <span className="vg-preference-value">{value}</span>}<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 5 7 7-7 7" /></svg></button>;
}
export function SettingsSwitch({ title, detail, checked, onChange, disabled, label }: { title: string; detail?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string }) {
  const id = useId();
  return <div className="vg-preference-row"><span className="vg-preference-copy"><strong>{title}</strong>{detail && <small id={id}>{detail}</small>}</span><button type="button" role="switch" aria-label={label ?? title} aria-describedby={detail ? id : undefined} aria-checked={checked} disabled={disabled} onClick={() => { onChange(!checked); breathe(); }} className="vg-preference-toggle"><span aria-hidden="true" /></button></div>;
}
export function SettingsChoices<T extends string | number>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; title: string; detail?: string }[]; onChange: (value: T) => void; disabled?: boolean }) {
  const name = useId();
  return <div className="vg-preference-choices" role="radiogroup" aria-label={label}>{options.map(option => <label key={option.value} className={`vg-preference-choice ${value === option.value ? 'is-selected' : ''}`}><span className="vg-preference-copy"><strong>{option.title}</strong>{option.detail && <small>{option.detail}</small>}</span><input type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} /></label>)}</div>;
}
