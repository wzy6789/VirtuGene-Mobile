/**
 * 世界空间的交互件（5.0.0 Living World §12 / §19 / §37 / §39 / §40）
 *
 * 三件东西共用一个原则：**它们都是快捷方式，不是唯一入口**。
 * - 人物 chips    ↔ 自然语言「让星遥过来」
 * - 世界控制面板  ↔ 自然语言「直接到第二天早上」「我们该结束了」
 * - 灵感建议      ↔ 用户自己输入
 * 每一句自然语言都能做到面板里的事，面板只是让用户少打字。
 */
import { useEffect, useRef, useState } from 'react';
import type { Character, WorldScene } from '../../db/index';
import { Avatar } from '../ui/Avatar';

/* ------------------------------------------------------------------ *
 * 在场人物 chips（§19）
 * ------------------------------------------------------------------ */
export function WorldPresenceChips(params: {
  present: Character[];
  absent: Character[];
  onSummon: (characterId: string) => void;
  onDismiss: (characterId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="vg-chips">
      {params.present.map((c) => (
        <button
          key={c.id}
          type="button"
          className="vg-chip vg-chip-on"
          onClick={() => params.onDismiss(c.id)}
          title={`让 ${c.name} 先离开（TA 的记忆不受影响）`}
        >
          <Avatar avatar={c.avatar || '🙂'} size="sm" />
          <span>{c.name}</span>
        </button>
      ))}
      {params.absent.length > 0 && (
        <div className="relative">
          <button type="button" className="vg-chip" onClick={() => setOpen((v) => !v)}>
            ＋ 叫谁过来
          </button>
          {open && (
            <div className="vg-chip-menu">
              {params.absent.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { params.onSummon(c.id); setOpen(false); }}
                >
                  <Avatar avatar={c.avatar || '🙂'} size="sm" />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 灵感建议（§37 / §38：只在导演认为用户站在岔路口时出现，永远可以无视）
 * ------------------------------------------------------------------ */
export function WorldSuggestions({ options, onPick, onDismiss }: {
  options: string[];
  onPick: (text: string) => void;
  onDismiss: () => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="vg-suggestions">
      <span className="vg-suggestions-label">也可以</span>
      {options.map((option) => (
        <button key={option} type="button" className="vg-suggestion" onClick={() => onPick(option)}>
          {option}
        </button>
      ))}
      <button type="button" className="vg-suggestion-close" onClick={onDismiss} aria-label="不用建议">×</button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 世界控制面板（§39）
 * ------------------------------------------------------------------ */
export type WorldControlAction =
  | { kind: 'characters_talk' }
  | { kind: 'time_skip'; label: string }
  | { kind: 'save_moment' }
  | { kind: 'pause' }
  | { kind: 'finish' }
  | { kind: 'undo' }
  | { kind: 'save_story' };

const TIME_SKIPS = ['过一会儿', '到晚上', '直接到第二天早上', '三天以后'];

export function WorldControlSheet(params: {
  open: boolean;
  scene: WorldScene | null;
  onClose: () => void;
  onAction: (action: WorldControlAction) => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!params.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') params.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [params.open, params.onClose]);

  if (!params.open) return null;
  return (
    <div className="vg-sheet-backdrop" onClick={params.onClose}>
      <div ref={ref} className="vg-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="vg-sheet-grab" aria-hidden />
        <p className="vg-sheet-title">世界控制</p>
        <p className="vg-sheet-hint">这些也可以用一句话做到，比如「直接到第二天早上」。</p>

        <div className="vg-sheet-group">
          <button type="button" disabled={params.busy} onClick={() => params.onAction({ kind: 'characters_talk' })}>
            <b>让他们自己聊一会儿</b>
            <span>你只要看着，随时可以插话</span>
          </button>
          <button type="button" disabled={params.busy} onClick={() => params.onAction({ kind: 'save_moment' })}>
            <b>保存这一刻</b>
            <span>请世界把刚刚发生的事记下来</span>
          </button>
          <button type="button" disabled={params.busy} onClick={() => params.onAction({ kind: 'save_story' })}>
            <b>保存为故事</b>
            <span>把这一段标成完整的一章</span>
          </button>
        </div>

        <div className="vg-sheet-group">
          <p className="vg-sheet-sub">跳过时间</p>
          <div className="vg-sheet-row">
            {TIME_SKIPS.map((label) => (
              <button key={label} type="button" disabled={params.busy} onClick={() => params.onAction({ kind: 'time_skip', label })}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="vg-sheet-group">
          <button type="button" disabled={params.busy} onClick={() => params.onAction({ kind: 'undo' })}>
            <b>撤销上一轮</b>
            <span>回到上一刻，世界不会留下它的痕迹</span>
          </button>
          <button type="button" disabled={params.busy} onClick={() => params.onAction({ kind: 'pause' })}>
            <b>先离开一会儿</b>
            <span>这一段会留着，回来继续</span>
          </button>
          <button type="button" disabled={params.busy} onClick={() => params.onAction({ kind: 'finish' })}>
            <b>结束这一段</b>
            <span>收束它，之后再开始新的一段</span>
          </button>
        </div>

        <button type="button" className="vg-sheet-cancel" onClick={params.onClose}>取消</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 输入区（§12：输入框是整个世界的操作系统）
 * ------------------------------------------------------------------ */
export function WorldComposer(params: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onOpenControls: () => void;
  busy: boolean;
  /** 当前有没有可用的 AI 服务（§55：没有就明确告诉用户，不让按钮一直转圈） */
  aiDetail: string | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    if (params.busy) return;
    params.onSend();
  };
  return (
    <div className="vg-composer">
      {params.aiDetail && <p className="vg-composer-warn">{params.aiDetail}</p>}
      <div className="vg-composer-row">
        <button type="button" className="vg-composer-control" onClick={params.onOpenControls} aria-label="世界控制">◍</button>
        <textarea
          ref={ref}
          rows={1}
          value={params.value}
          onChange={(e) => params.onChange(e.target.value)}
          onKeyDown={(e) => {
            // Android WebView：Enter 直接送出，Shift+Enter 换行；中文输入法组合中的 Enter 不拦
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="说句话，做件事，或者改变这个世界……"
          className="vg-composer-input"
        />
        <button
          type="button"
          onClick={send}
          disabled={params.busy || !params.value.trim()}
          className="vg-composer-send"
        >
          {params.busy ? '…' : '送出'}
        </button>
      </div>
    </div>
  );
}
