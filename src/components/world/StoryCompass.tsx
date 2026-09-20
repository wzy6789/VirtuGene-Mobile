import { useState } from 'react';
import type { WorldScene, WorldSceneEntry } from '../../db';

/** Only persisted scene facts are presented as history; actions remain user proposals. */
export function StoryCompass({ scene, entries, busy, onAct, onGoal }: {
  scene: WorldScene;
  entries: WorldSceneEntry[];
  busy: boolean;
  onAct: (text: string) => void;
  onGoal: (goal: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState(scene.state.sceneGoal ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const traces = entries.filter((entry) => entry.kind === 'user_input' || entry.kind === 'choice').slice(-3);
  return <section className="vg-story-compass">
    <button className="vg-story-compass-heading" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span><small>正在经历</small><strong>{scene.title}</strong></span>
      <span>{open ? '收起' : '故事方向'} {open ? '−' : '+'}</span>
    </button>
    {open && <div className="vg-story-compass-body">
      <label>这一段，你想尝试什么？<input value={goal} maxLength={180} onChange={(event) => setGoal(event.target.value)} placeholder="例如：找出钟楼停止的原因" /></label>
      <button disabled={saving || busy} onClick={async () => {
        setSaving(true); setError('');
        try { await onGoal(goal.trim()); } catch { setError('方向没有保存，请再试一次。'); }
        finally { setSaving(false); }
      }}>{saving ? '保存中…' : '设定方向'}</button>
      {error && <p role="alert">{error}</p>}
      {!!scene.state.activeConflicts.length && <div><h3>尚未解开的事</h3>{scene.state.activeConflicts.slice(-3).map((item, index) => <p key={index}>{item}</p>)}</div>}
      {!!traces.length && <div><h3>你走过的几步</h3>{traces.map((entry) => <p key={entry.id}>{entry.content}</p>)}</div>}
      <div className="vg-story-compass-actions">
        <button disabled={busy} onClick={() => { setOpen(false); onAct('我先不说话，仔细观察现场，寻找一个可以亲自调查的具体细节。不要替我决定下一步。'); }}>观察现场</button>
        <button disabled={busy} onClick={() => { setOpen(false); onAct('我先旁观一会，让在场的人按各自的目标继续行动和彼此交流，不必围着我。'); }}>静观其变</button>
        <button disabled={busy} onClick={() => { setOpen(false); onAct('推进眼前这件事：让刚才的行动产生一个具体、合理的后果，给我留下决定如何应对的空间。'); }}>推进事件</button>
      </div>
    </div>}
  </section>;
}
