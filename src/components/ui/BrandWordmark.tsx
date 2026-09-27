import { useId } from 'react';

/** The message-page signature has a living double filament behind stable type. */
export function BrandWordmark({ prominent = false }: { prominent?: boolean }) {
  const id = useId().replace(/:/g, '');
  return <span className={`vg-wordmark${prominent ? ' is-signature' : ''}`}>
    {prominent && <svg className="vg-wordmark-filaments" viewBox="0 0 260 76" fill="none" aria-hidden="true" focusable="false">
      <defs><linearGradient id={`vg-signature-${id}`} x1="0" y1="0" x2="260" y2="70" gradientUnits="userSpaceOnUse">
        <stop stopColor="#9C78FF" stopOpacity="0" /><stop offset=".25" stopColor="#A890FF" stopOpacity=".75" />
        <stop offset=".63" stopColor="#7CE5DE" stopOpacity=".6" /><stop offset="1" stopColor="#7CE5DE" stopOpacity="0" />
      </linearGradient></defs>
      <g stroke={`url(#vg-signature-${id})`} strokeLinecap="round">
        <path className="vg-wordmark-filament-a" d="M2 52C38 76 78 5 130 21S208 67 258 28" strokeWidth="1.2" />
        <path className="vg-wordmark-filament-b" d="M2 25C52 4 82 67 133 54S206 1 258 25" strokeWidth=".8" />
      </g>
    </svg>}
    <span className="vg-wordmark-face">VIRTUGENE</span>
    <span className="vg-wordmark-reflection" data-text="VIRTUGENE" aria-hidden="true" />
    {prominent && <span className="vg-wordmark-sparks" aria-hidden="true"><i /><i /><i /></span>}
  </span>;
}
