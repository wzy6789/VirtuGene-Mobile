const RUNGS = Array.from({ length: 9 }, (_, i) => i);

export function SplashScreen() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-7 bg-app select-none">
      <svg width="64" height="132" viewBox="0 0 64 132" fill="none" aria-hidden>
        {/* backbones */}
        <path d="M18 6 C 2 40, 2 92, 18 126" stroke="#6C5CE7" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.85" />
        <path d="M46 6 C 62 40, 62 92, 46 126" stroke="#6C5CE7" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.85" />
        {/* rungs */}
        {RUNGS.map((i) => {
          const y = 14 + i * 13;
          const half = Math.sin((i / 8) * Math.PI) * 13 + 5;
          return (
            <line
              key={i}
              x1={32 - half}
              y1={y}
              x2={32 + half}
              y2={y}
              stroke={i % 2 === 0 ? '#00CEC9' : '#7C6FF7'}
              strokeWidth="3"
              strokeLinecap="round"
              className="dna-rung"
              style={{ animationDelay: `${i * 0.09}s` }}
            />
          );
        })}
      </svg>

      <div className="text-center space-y-2">
        <p className="text-sm font-semibold tracking-[0.3em] text-ink">VIRTUGENE</p>
        <p className="text-[11px] tracking-[0.15em] text-gray-500">Unlock Your Digital Soul</p>
      </div>
    </div>
  );
}
