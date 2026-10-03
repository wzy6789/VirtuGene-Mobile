import { useId, useRef, useState } from 'react';
import { SecretaryIcon, type SecretaryIconName } from './SecretaryIcon';

const writingActions: [string, string, SecretaryIconName][] = [
  ['记日记', '帮我记篇今天的日记：', 'diary'],
  ['写朋友圈', '帮我写一条朋友圈：', 'moment'],
  ['加待办', '帮我添加待办：', 'todo'],
];

export function SecretaryQuickActions({ busy, vacant, onDraft, onSend, onInbox, onManage, onReview }: {
  busy: boolean; vacant: boolean; onDraft: (draft: string) => void; onSend: (request: string) => void;
  onInbox: () => void; onManage: () => void; onReview: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const disabled = busy || vacant;
  const detailsId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const toggle = () => {
    if (expanded && detailsRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
    setExpanded(value => !value);
  };
  return <div className="vg-secretary-tools shrink-0 border-b border-line">
    <div className="vg-secretary-tool-heading flex items-center justify-between gap-2">
      <button type="button" onClick={onInbox} className="vg-secretary-inbox-link"><SecretaryIcon name="inbox" size={17} />办事收件箱<SecretaryIcon name="chevron" size={12} /></button>
      <button type="button" aria-label="助理管理" disabled={busy} onClick={onManage} className="vg-secretary-manage-link disabled:opacity-40"><SecretaryIcon name="profile" size={15} />{vacant ? '聘用助理' : '助理管理'}</button>
    </div>
    <div className="vg-secretary-quick-grid" role="group" aria-label="助理快捷办事">
      {writingActions.map(([label, draft, icon]) => <button key={label} type="button" disabled={disabled} onClick={() => onDraft(draft)} className="vg-secretary-shortcut disabled:opacity-40"><SecretaryIcon name={icon} size={17} />{label}</button>)}
      <button ref={toggleRef} type="button" aria-label={expanded ? '收起更多办事' : '展开更多办事'} aria-expanded={expanded} aria-controls={detailsId} onClick={toggle} className={`vg-secretary-shortcut vg-secretary-quick-toggle ${expanded ? 'is-expanded' : ''}`}><SecretaryIcon name="settings" size={17} />{expanded ? '收起' : '更多'}</button>
    </div>
    <div ref={detailsRef} id={detailsId} inert={!expanded} aria-hidden={!expanded} className={`vg-secretary-quick-details ${expanded ? 'is-expanded' : ''}`}>
      <div className="vg-secretary-quick-clip">
        <div className="vg-secretary-quick-secondary" role="group" aria-label="更多助理办事">
          <button type="button" disabled={disabled} onClick={() => onSend('今天还有什么待办没完成？')} className="vg-secretary-shortcut disabled:opacity-40"><SecretaryIcon name="calendar" size={17} />今天安排</button>
          <button type="button" disabled={disabled} onClick={() => onDraft('帮我查找日记，关键词是：')} className="vg-secretary-shortcut disabled:opacity-40"><SecretaryIcon name="search" size={17} />查记录</button>
          <button type="button" disabled={disabled} onClick={() => onDraft('帮我修改待办：')} className="vg-secretary-shortcut disabled:opacity-40"><SecretaryIcon name="edit" size={17} />改待办</button>
          <button type="button" disabled={disabled} onClick={onReview} className="vg-secretary-shortcut is-review disabled:opacity-40"><SecretaryIcon name="spark" size={17} />每日整理</button>
        </div>
      </div>
    </div>
  </div>;
}
