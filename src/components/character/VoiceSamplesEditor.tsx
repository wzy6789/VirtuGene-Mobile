import { useEffect, useRef, useState } from 'react';
import type { Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { generateVoiceSamples } from '../../lib/ai/character-voice-generator';
import { validVoiceSamples, voicePromptRevision, voiceSampleBlock, type VoiceSamples } from '../../lib/character-voice';

export function VoiceSamplesEditor({ character, value, onChange, disabled }: {
  character: Character; value?: VoiceSamples; onChange: (value?: VoiceSamples) => void; disabled?: boolean;
}) {
  const ownerId = useAuthStore(s => s.userId);
  const apiKey = useAuthStore(s => s.apiKey);
  const revision = voicePromptRevision(character);
  const [preview, setPreview] = useState<VoiceSamples>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++; controller.current?.abort(); setPreview(undefined); setError('');
    return () => { epoch.current++; controller.current?.abort(); };
  }, [revision, ownerId]);
  const cached = validVoiceSamples({ ...character, voiceSamples: value });
  const generate = async () => {
    if (busy || disabled || ownerId !== character.createdBy) return;
    const request = new AbortController(); controller.current = request;
    const currentEpoch = epoch.current;
    setBusy(true); setError('');
    try {
      const samples = await generateVoiceSamples(character, apiKey ?? '', request.signal);
      if (currentEpoch === epoch.current && !request.signal.aborted && useAuthStore.getState().userId === ownerId) setPreview(samples);
    } catch (e) { if (currentEpoch === epoch.current && !request.signal.aborted) setError(e instanceof Error ? e.message : '声音样本暂未补全，请检查模型设置后重试。'); }
    finally { if (controller.current === request) setBusy(false); }
  };
  return <section className="rounded-xl border border-line p-4 space-y-3" aria-label="角色声音样本">
    <p className="text-sm font-medium text-ink">声音样本</p>
    <p className="text-xs text-sub">补充称呼、看事情的方式和对话示例。先预览再采用，原人物设定保持原样。</p>
    <button type="button" disabled={disabled || busy || !character.systemPrompt.trim() || ownerId !== character.createdBy} onClick={() => void generate()} className="min-h-11 rounded-xl border border-gene-purple/30 px-4 text-sm text-gene-purple disabled:opacity-40">{busy ? '正在补全声音样本…' : '补全声音样本'}</button>
    {preview && <div className="space-y-2">
      <pre aria-label="声音样本预览" className="whitespace-pre-wrap break-words rounded-xl bg-surface p-3 text-sm font-sans text-ink">{voiceSampleBlock({ ...character, voiceSamples: preview })}</pre>
      <button type="button" disabled={disabled} onClick={() => { if (validVoiceSamples({ ...character, voiceSamples: preview })) { onChange(preview); setPreview(undefined); } }} className="min-h-11 rounded-xl bg-gene-purple px-4 text-sm text-white">采用声音样本</button>
      <button type="button" onClick={() => setPreview(undefined)} className="min-h-11 px-3 text-sm text-sub">放弃这版</button>
    </div>}
    {cached && <div><p role="status" className="text-xs text-sub">已采用这版声音样本，点击“保存角色”后生效。</p><details className="text-sm text-sub"><summary className="min-h-11 flex items-center cursor-pointer">查看采用的声音样本</summary><pre className="whitespace-pre-wrap break-words font-sans">{cached.lines.join('\n')}</pre></details><button type="button" disabled={disabled} onClick={() => onChange(undefined)} className="min-h-11 text-sm text-sub">移除补全样本</button></div>}
    {error && <p role="alert" className="text-sm text-red-400 break-words">{error}</p>}
  </section>;
}
