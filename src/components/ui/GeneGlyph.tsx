/** Brand DNA mark: identical strokes across browsers and Android devices. */
export function GeneGlyph({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 3c0 9 10 9 10 18M17 3c0 9-10 9-10 18M8 6h8M8 18h8M10 9h4M10 15h4" />
    </svg>
  );
}
