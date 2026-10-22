import { Modal } from '../ui/Modal';
import { GeneGlyph } from '../ui/GeneGlyph';

interface Props {
  open: boolean;
  onClose: () => void;
  version: string;
  notes: string[];
}

export function UpdateNotesModal({ open, onClose, version, notes }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="更新说明" width="max-w-md" presentation="dialog" footer={<button type="button" onClick={onClose} className="vg-button vg-button-primary w-full">知道了</button>}>
      <div className="relative overflow-hidden">
        {/* Brand header with DNA accent */}
        <div className="px-5 pt-5 pb-5 bg-surface border-b border-line">
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="w-12 h-12 rounded-xl border border-line bg-panel flex items-center justify-center text-[color:var(--vg-accent)] shrink-0">
              <GeneGlyph size={28} />
            </div>
            <div className="min-w-0">
              <p className="text-xs tracking-[0.12em] text-sub font-medium uppercase">
                VirtuGene
              </p>
              <h2 className="text-lg font-semibold text-ink leading-tight">这次带来了什么</h2>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line bg-panel text-ink text-xs tabular-nums">
              v{version}
            </span>
            <span className="text-xs text-sub">本次更新内容</span>
          </div>
        </div>

        {/* Notes list */}
        <ul className="px-5 py-5 space-y-4" aria-label="更新内容">
          {notes.map((note, i) => (
            <li key={i} className="flex items-start gap-3">
              <span aria-hidden="true" className="mt-2 w-1.5 h-1.5 rounded-full bg-[var(--vg-accent)] shrink-0" />
              <span className="text-sm text-ink leading-7">{note}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
