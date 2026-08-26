interface Props {
  isOpen: boolean;
  hasData: boolean;
  valence?: number;
  onClick: () => void;
}

function getValenceColor(valence?: number) {
  if (valence == null) return 'text-gray-500 hover:text-sub';
  if (valence >= 7.5) return 'text-life-cyan hover:text-[#00B8B3]';
  if (valence >= 5) return 'text-amber-400 hover:text-amber-300';
  if (valence >= 2.5) return 'text-orange-400 hover:text-orange-300';
  return 'text-red-400 hover:text-red-300';
}

export function EmotionToggleButton({ isOpen, hasData, valence, onClick }: Props) {
  return (
    <button
      id="guide-emotion"
      onClick={onClick}
      title="情绪图谱"
      className={`relative w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
        isOpen
          ? 'bg-gene-purple/20 text-gene-purple'
          : `${getValenceColor(valence)} bg-surface hover:bg-surface-strong`
      }`}
    >
      {/* Heart icon */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill={hasData ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>

      {/* Colored dot indicator when data exists */}
      {hasData && (
        <span
          className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-app ${
            valence != null && valence >= 7.5
              ? 'bg-life-cyan'
              : valence != null && valence >= 5
                ? 'bg-amber-400'
                : valence != null && valence >= 2.5
                  ? 'bg-orange-400'
                  : 'bg-red-400'
          }`}
        />
      )}
    </button>
  );
}
