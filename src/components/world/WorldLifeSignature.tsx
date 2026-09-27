import { useId } from 'react';

/** A slender double helix; rungs follow the strands instead of a flat ladder. */
export function WorldLifeSignature() {
  const id = useId().replace(/:/g, '');
  return <svg className="vg-world-helix" viewBox="0 0 80 144" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`life-a-${id}`} x1="20" y1="8" x2="60" y2="136" gradientUnits="userSpaceOnUse">
        <stop stopColor="#C5B4FF" stopOpacity=".15" /><stop offset=".25" stopColor="#B49AF5" /><stop offset=".7" stopColor="#99E5DF" /><stop offset="1" stopColor="#99E5DF" stopOpacity=".12" />
      </linearGradient>
      <linearGradient id={`life-b-${id}`} x1="60" y1="8" x2="20" y2="136" gradientUnits="userSpaceOnUse">
        <stop stopColor="#8DDCD9" stopOpacity=".12" /><stop offset=".25" stopColor="#82CFCF" /><stop offset=".75" stopColor="#AC96EB" /><stop offset="1" stopColor="#AC96EB" stopOpacity=".15" />
      </linearGradient>
    </defs>
    <g transform="rotate(14 40 72)" strokeLinecap="round">
      <g className="vg-world-helix-rungs">
        {Array.from({length: 15}, (_, i) => {
          const y = 16 + i * 8;
          const spread = 19 * Math.sin((y - 12) * Math.PI / 32);
          return <path key={y} d={`M${40 - spread} ${y}h${2 * spread}`} stroke={`url(#life-b-${id})`} strokeWidth=".85" opacity={.2 + Math.abs(spread) / 19 * .35} />;
        })}
      </g>
      <path d="M40 12C65 23 65 33 40 44S15 65 40 76S65 97 40 108S15 129 40 140" stroke={`url(#life-a-${id})`} strokeWidth="2" />
      <path d="M40 12C15 23 15 33 40 44S65 65 40 76S15 97 40 108S65 129 40 140" stroke={`url(#life-b-${id})`} strokeWidth="1.65" />
      <path className="vg-world-helix-signal" d="M40 12C65 23 65 33 40 44S15 65 40 76S65 97 40 108S15 129 40 140" stroke="#E0FFF8" strokeWidth="2" pathLength="100" strokeDasharray="6 94" />
    </g>
  </svg>;
}
