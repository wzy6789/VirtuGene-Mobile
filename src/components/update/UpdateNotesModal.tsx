import { Modal } from '../ui/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  version: string;
  notes: string[];
}

export function UpdateNotesModal({ open, onClose, version, notes }: Props) {
  return (
    <Modal open={open} onClose={onClose} width="max-w-md">
      <div className="relative overflow-hidden">
        {/* Brand header with DNA accent */}
        <div className="px-6 pt-6 pb-5 bg-gradient-to-br from-gene-purple/15 via-transparent to-life-cyan/10 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gene-purple/20 flex items-center justify-center text-2xl shrink-0">
              🧬
            </div>
            <div className="min-w-0">
              <p className="text-[10px] tracking-[0.2em] text-life-cyan font-medium uppercase">
                Unlock Your Digital Soul
              </p>
              <h2 className="text-lg font-bold text-ink leading-tight">基因序列已更新</h2>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gene-purple/20 text-gene-purple text-xs font-mono">
              <span className="w-1 h-1 rounded-full bg-gene-purple animate-pulse" />
              v{version}
            </span>
            <span className="text-xs text-gray-500">本次更新内容</span>
          </div>
        </div>

        {/* Notes list */}
        <div className="px-6 py-5 space-y-3">
          {notes.map((note, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-life-cyan shrink-0" />
              <span className="text-sm text-sub leading-relaxed">{note}</span>
            </div>
          ))}
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-gene-purple hover:bg-[#5B4BD4] text-sm font-medium text-white transition-colors"
          >
            知道了
          </button>
        </div>
      </div>
    </Modal>
  );
}
