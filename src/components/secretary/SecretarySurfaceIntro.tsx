import { SecretaryIcon, type SecretaryIconName } from './SecretaryIcon';

export function SecretarySurfaceIntro({ icon, title, detail, value }: { icon: SecretaryIconName; title: string; detail: string; value?: string }) {
  return <div className="vg-secretary-surface-intro">
    <div className="vg-secretary-surface-heading"><span className="vg-secretary-icon-tile"><SecretaryIcon name={icon} size={21} /></span><h3>{title}</h3>{value && <span className="vg-secretary-surface-value">{value}</span>}</div>
    <p>{detail}</p>
  </div>;
}
