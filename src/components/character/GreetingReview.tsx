import { useEffect, useRef, useState } from 'react';
import type { Character } from '../../db';
import { auditGreeting, suggestGreeting } from '../../lib/greeting-review';
import { voicePromptRevision } from '../../lib/character-voice';
import { useAuthStore } from '../../store/auth-store';

export function GreetingReview({ character, onAdopt, disabled }: { character: Character; onAdopt: (text: string) => void; disabled?: boolean }) {
  const owner = useAuthStore(s => s.userId), apiKey = useAuthStore(s => s.apiKey);
  const revision = voicePromptRevision(character), request = useRef<AbortController | undefined>(undefined);
  const [preview, setPreview] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { request.current?.abort(); setPreview(''); setError(''); setBusy(false); return () => request.current?.abort(); }, [revision, owner]);
  const issues = auditGreeting(character.greeting);
  return <section aria-label="开场白审查" className="space-y-2 text-sm">
    {issues.map(issue => <p key={issue} className="text-sub">{issue}</p>)}
    <p className="text-xs text-sub">开场白会影响后续语气。可以生成一版普通聊天建议，先预览再决定。</p>
    <button type="button" disabled={disabled || busy || owner !== character.createdBy} className="min-h-11 text-gene-purple" onClick={async () => {
      const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
      try { const text = await suggestGreeting(character, apiKey ?? '', controller.signal); if (!controller.signal.aborted && useAuthStore.getState().userId === owner) setPreview(text); }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '暂时无法生成。'); }
      finally { if (request.current === controller) setBusy(false); }
    }}>{busy ? '正在准备建议…' : '预览聊天开场白建议'}</button>
    {preview && <div className="rounded-xl bg-surface p-3 space-y-2"><p className="break-words" aria-label="开场白建议">{preview}</p><button type="button" disabled={disabled} className="min-h-11 mr-4 text-gene-purple" onClick={() => { onAdopt(preview); setPreview(''); }}>采用开场白</button><button type="button" className="min-h-11 text-sub" onClick={() => setPreview('')}>放弃这版</button><p className="text-xs text-sub">保存角色后用于新会话，旧聊天保持原样。</p></div>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </section>;
}
