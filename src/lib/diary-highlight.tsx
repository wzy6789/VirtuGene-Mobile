import { splitByTerms } from './diary-utils';

/** 高亮片段渲染（配合 splitByTerms） */
export function HighlightText({ text, terms, className }: { text: string; terms: string[]; className?: string }) {
  const parts = splitByTerms(text, terms);
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-life-cyan/30 text-inherit rounded-[2px] px-0.5">{p.text}</mark>
        ) : (
          <span key={i} className={className}>{p.text}</span>
        ),
      )}
    </>
  );
}
