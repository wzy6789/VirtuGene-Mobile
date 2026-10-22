import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CallView } from '../../lib/voice-call/controller';
import { confirmedCallSpeech, type VoiceCallRecord } from '../../lib/voice-call/record';
import { Icon } from '../ui/Icon';

type CaptionView = Pick<CallView, 'phase' | 'inputMode' | 'userText' | 'heardText' | 'speakingText'>;

/** Current speech and durable, acknowledged speech are separate reading surfaces.
 * No generated draft, inferred waveform, or new model request enters this component. */
export const VoiceCallCaptions = memo(function VoiceCallCaptions({ name, view, record, fontSize = 'standard' }: {
  name: string;
  view: CaptionView;
  record?: VoiceCallRecord;
  fontSize?: 'standard' | 'large';
}) {
  const [history, setHistory] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const currentRef = useRef<HTMLDivElement>(null);
  const [needsExpansion, setNeedsExpansion] = useState(false);
  const turns = useMemo(() => (record?.exchanges ?? []).map(exchange => ({
    id:exchange.turnId, user:exchange.userText.trim(), speech:confirmedCallSpeech(exchange), interrupted:exchange.interrupted,
  })).filter(turn => turn.user || turn.speech), [record?.exchanges]);
  const speaking = view.phase === 'playing' ? view.speakingText ?? '' : '';
  const heard = view.heardText;
  const speech = speaking && !heard.endsWith(speaking) ? `${heard}${speaking}` : heard || speaking;
  const hasCurrent = !!(view.userText || speech);
  useLayoutEffect(() => {
    const node = currentRef.current;
    if (!node || expanded) return;
    const measure = () => setNeedsExpansion([...node.querySelectorAll('p')].some(p => p.scrollHeight > p.clientHeight + 1));
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [view.userText, speech, history, expanded]);
  return <section className={`vg-voice-call-captions${expanded ? ' is-expanded' : ''}${history ? ' is-history' : ''}${fontSize === 'large' ? ' is-large-text' : ''}`} aria-label={history ? '本次通话字幕记录' : '当前通话字幕'}>
    <div className="vg-voice-caption-heading"><strong>{history ? '本次记录' : '当前字幕'}</strong>
      <button type="button" onClick={() => setHistory(value => !value)} aria-pressed={history}><Icon name={history ? 'mic' : 'clock'} size={15} />{history ? '返回当前' : `本次记录${turns.length ? ` · ${turns.length}` : ''}`}</button>
    </div>
    {history ? <div className="vg-voice-caption-history" tabIndex={0} aria-label="已确认的本次交流，可滚动回看">
      {turns.length ? turns.map(turn => <div className="vg-voice-caption-turn" key={turn.id}>
        {turn.user && <div className="vg-voice-caption-line"><span className="vg-voice-caption-person">你</span><p>{turn.user}</p></div>}
        {turn.speech && <div className="vg-voice-caption-line"><span className="vg-voice-caption-person">{name}</span><p>{turn.speech}</p></div>}
        {turn.interrupted && <small>本轮曾中断，仅列出确认完整播放的台词。</small>}
      </div>) : <p className="vg-voice-caption-empty">本次还没有完成的交流。当前回应可以在“返回当前”中查看。</p>}
    </div> : <>
      <div ref={currentRef} className="vg-voice-caption-current">
        {view.userText && <div className="vg-voice-caption-line"><span className="vg-voice-caption-person">你</span><p>{view.userText}</p></div>}
        {speech && <div className="vg-voice-caption-line"><span className="vg-voice-caption-person">{name}</span><div><p>{speech}</p>{speaking && <small>正在播放</small>}</div></div>}
        {!hasCurrent && <p className="vg-voice-caption-empty">{view.inputMode === 'text' ? '发送文字后，在这里看见你们的对话。' : '说完后稍作停顿，识别的文字会出现在这里。'}</p>}
      </div>
      {hasCurrent && needsExpansion && <button type="button" className="vg-voice-caption-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起完整字幕' : '展开完整字幕'}<Icon name="chevron" size={14} /></button>}
    </>}
  </section>;
});
