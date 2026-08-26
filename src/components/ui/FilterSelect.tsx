import { useEffect, useRef, useState } from 'react';

export interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  placeholder?: string;
  className?: string;
  /** 按钮样式覆盖（默认小号筛选样式；弹窗内用大号） */
  buttonClassName?: string;
}

/** 主题化下拉（替代原生 select，避免深色模式下的白色弹层） */
export function FilterSelect({ value, onChange, options, placeholder = '请选择', className = '', buttonClassName }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = options.find((o) => o.value === value);
  const btnCls = buttonClassName ?? 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface border border-line text-xs text-ink hover:border-gene-purple/40 transition-colors';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={btnCls}
      >
        <span className="truncate">{current?.label ?? placeholder}</span>
        <span className="text-gray-400 shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[140px] max-h-64 overflow-y-auto py-1.5 glass-card rounded-xl shadow-xl animate-fade-in">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${o.value === value ? 'text-gene-purple bg-gene-purple/10' : 'text-sub hover:bg-surface'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
