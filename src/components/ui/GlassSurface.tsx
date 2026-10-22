import type {HTMLAttributes,ReactNode} from 'react';
import '../../styles/glass-surfaces.css';
type Props=HTMLAttributes<HTMLDivElement>&{roleType?:'control'|'content'|'reading';quality?:'realtime'|'hybrid'|'static';children:ReactNode};
/** Only the material substrate deforms; content and its hit geometry remain rigid. */
export function GlassSurface({roleType='content',quality='hybrid',className='',children,...props}:Props){
 return <div {...props} className={`vg-glass-surface ${className}`} data-glass-role={roleType} data-glass-quality={quality}>
  <span className="vg-glass-material" aria-hidden="true"/><div className="vg-glass-content">{children}</div>
 </div>;
}
