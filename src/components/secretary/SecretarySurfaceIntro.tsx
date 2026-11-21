import { SecretaryIcon, type SecretaryIconName } from './SecretaryIcon';

export function SecretarySurfaceIntro({ icon, title, detail, value, headingLevel = 3 }: { icon: SecretaryIconName; title: string; detail: string; value?: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return <div className="vg-secretary-surface-intro">
    <div className="vg-secretary-surface-heading"><span className="vg-secretary-icon-tile"><SecretaryIcon name={icon} size={21} /></span><Heading className="vg-secretary-surface-title">{title}</Heading>{value && <span className="vg-secretary-surface-value">{value}</span>}</div>
    <p>{detail}</p>
  </div>;
}
