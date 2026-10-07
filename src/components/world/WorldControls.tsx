import { Icon } from '../ui/Icon';
/**
 * 世界空间的交互件（5.0.0 Living World §12 / §19 / §37 / §39 / §40）
 *
 * 三件东西共用一个原则：**它们都是快捷方式，不是唯一入口**。
 * - 人物 chips    ↔ 自然语言「让星遥过来」
 * - 世界控制面板  ↔ 自然语言「直接到第二天早上」「我们该结束了」
 * - 灵感建议      ↔ 用户自己输入
 * 每一句自然语言都能做到面板里的事，面板只是让用户少打字。
 */
import { useRef, useState } from 'react';
import type { Character, WorldScene } from '../../db/index';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import { SettingsChoices, SettingsGroup, SettingsRow } from '../settings/SettingsUI';

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
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  if (!open) {
    return (
      <div className="vg-suggestions is-collapsed">
        <button type="button" className="vg-suggestion-peek" onClick={() => setOpen(true)}>
          <span>灵感</span>
          <b>{options[0]}</b>
          <i aria-hidden="true">⌃</i>
        </button>
      </div>
    );
  }
  return (
    <div className="vg-suggestions is-open">
      <div className="vg-suggestions-head">
        <span className="vg-suggestions-label">如果你想换个方向</span>
        <button type="button" className="vg-suggestion-close" onClick={() => { setOpen(false); onDismiss(); }} aria-label="收起灵感"><Icon name="close" size={18} /></button>
      </div>
      {options.map((option) => (
        <button key={option} type="button" className="vg-suggestion" onClick={() => onPick(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 世界控制面板（§39）
 * ------------------------------------------------------------------ */
export type WorldControlAction =
  | { kind: 'characters_talk' }
  | { kind: 'entry_mode'; mode: 'memory' | 'present' | 'amnesiac' }
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
  entryMemoryMode: 'memory' | 'present' | 'amnesiac';
}) {
  const [confirmFinish, setConfirmFinish] = useState(false);
  if (!params.open) return null;
  const act = (action: WorldControlAction) => { if (!params.busy) params.onAction(action); };
  return <>
    <Modal open onClose={params.onClose} title="世界偏好" mobileFullHeight panelClassName="vg-settings-panel">
      <div className="vg-settings-design vg-sheet-content">
        <p className="vg-settings-intro">{params.scene?.place || '当前世界'} · 这些操作只影响当前这一段世界。</p>
        <SettingsGroup title="角色加入时" scope="当前这一段"><SettingsChoices label="角色加入方式" value={params.entryMemoryMode} disabled={params.busy} onChange={mode => act({ kind: 'entry_mode', mode })} options={[{ value: 'memory', title: '带上你们的记忆', detail: '沿用已有的共同经历与关系' }, { value: 'present', title: '从此刻开始参与', detail: '从当前场景开始加入' }, { value: 'amnesiac', title: '失忆设定', detail: '以失忆状态参与这一段世界' }]} /></SettingsGroup>
        <SettingsGroup title="继续这段故事"><div inert={params.busy}>
          <SettingsRow title="让他们自己聊一会儿" detail="随时可以插话" icon="account" onClick={() => act({ kind: 'characters_talk' })} />
          <SettingsRow title="写入世界记录" detail="收进世界的记录，之后可以回看" icon="diary" onClick={() => act({ kind: 'save_story' })} />
          <SettingsRow title="保存这一刻" detail="记住这一刻，世界继续" icon="edit" onClick={() => act({ kind: 'save_moment' })} />
        </div></SettingsGroup>
        <SettingsGroup title="推进时间"><div className="vg-world-time-choices">{TIME_SKIPS.map(label => <button type="button" key={label} disabled={params.busy} onClick={() => act({ kind: 'time_skip', label })}>{label}</button>)}</div></SettingsGroup>
        <SettingsGroup title="离开与调整"><div inert={params.busy}>
          <SettingsRow title="暂时离开" detail="保留进行状态，之后可以继续" icon="clock" onClick={() => act({ kind: 'pause' })} />
          <SettingsRow title="撤销上一轮" detail="回到上一刻，不保留上一轮的变化" icon="edit" onClick={() => act({ kind: 'undo' })} />
        </div></SettingsGroup>
        <SettingsGroup title="结束与结算"><div inert={params.busy}><SettingsRow title="结束这一段世界" detail="结算经历与关系变化，之后只可回看" danger icon="world" onClick={() => setConfirmFinish(true)} /></div></SettingsGroup>
      </div>
    </Modal>
    <Modal presentation="dialog" open={confirmFinish} onClose={() => setConfirmFinish(false)} title="结束这一段世界？" panelClassName="vg-settings-panel"><div className="vg-settings-design"><p className="vg-settings-intro">经历、共同记忆与关系变化会按原有规则结算。这一段结束后只能回看；想稍后继续，请选择“暂时离开”。</p><div className="flex gap-3"><button type="button" className="flex-1 text-sub" onClick={() => setConfirmFinish(false)}>继续参与</button><button type="button" disabled={params.busy} className="flex-1 rounded-xl bg-red-500/15 text-red-400" onClick={() => { act({ kind: 'finish' }); setConfirmFinish(false); }}>确认结束</button></div></div></Modal>
  </>;
}

/* ------------------------------------------------------------------ *
 * 输入区（§12：输入框是整个世界的操作系统）
 * ------------------------------------------------------------------ */
export function WorldComposer(params: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFocusInput?: () => void;
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
      <div className="vg-search-field vg-composer-row">
        <button type="button" className="vg-composer-control" onClick={params.onOpenControls} aria-label="世界控制">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h10M4 17h16M18 7h2M10 17h2" />
            <circle cx="17" cy="7" r="2" />
            <circle cx="7" cy="17" r="2" />
          </svg>
        </button>
        <textarea
          ref={ref}
          rows={1}
          aria-label="世界消息内容"
          value={params.value}
          onFocus={params.onFocusInput}
          onClick={params.onFocusInput}
          onChange={(e) => params.onChange(e.target.value)}
          onKeyDown={(e) => {
            // Android WebView：Enter 直接送出，Shift+Enter 换行；中文输入法组合中的 Enter 不拦
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="让世界继续发生……"
          className="vg-composer-input"
        />
        <button
          type="button"
          onClick={send}
          disabled={params.busy || !params.value.trim()}
          className="vg-composer-send"
          aria-label={params.busy ? '世界正在回应' : '发送'}
        >
          {params.busy ? (
            <span className="vg-composer-thinking" aria-hidden="true"><i /><i /><i /></span>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
