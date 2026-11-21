import { memo, useMemo, useState } from 'react';
import type { CallView } from '../../lib/voice-call/controller';
import { confirmedCallSpeech, type VoiceCallRecord } from '../../lib/voice-call/record';
import { Icon } from '../ui/Icon';

type CaptionView = Pick<CallView, 'phase' | 'inputMode' | 'userText' | 'heardText' | 'speakingText'>;

/** Current speech and durable, acknowledged speech are separate reading surfaces.
 * No generated draft, inferred waveform, or new model request enters this component. */
export const VoiceCallCaptions = memo(function VoiceCallCaptions({ name, view, record, fontSize = 'standard', onHistoryChange }: {
  name: string;
  view: CaptionView;
  record?: VoiceCallRecord;
  fontSize?: 'standard' | 'large';
  onHistoryChange?: (history: boolean) => void;
}) {
  const [history, setHistory] = useState(false);
  const turns = useMemo(() => (record?.exchanges ?? []).map(exchange => ({
    id:exchange.turnId, user:exchange.userText.trim(), speech:confirmedCallSpeech(exchange), interrupted:exchange.interrupted,
  })).filter(turn => turn.user || turn.speech), [record?.exchanges]);
  const speaking = view.phase === 'playing' ? view.speakingText ?? '' : '';
  const heard = view.heardText;
  const speech = speaking && !heard.endsWith(speaking) ? `${heard}${speaking}` : heard || speaking;
  const hasCurrent = !!(view.userText || speech);
  return <section className={`vg-voice-call-captions${history ? ' is-history' : ''}${fontSize === 'large' ? ' is-large-text' : ''}`} aria-label={history ? '本次通话字幕记录' : '当前通话字幕'}>
    <div className="vg-voice-caption-heading"><strong>{history ? '本次记录' : '当前字幕'}</strong>
      <button type="button" onClick={() => { setHistory(!history); onHistoryChange?.(!history); }} aria-pressed={history}><Icon name={history ? 'mic' : 'clock'} size={15} />{history ? '返回当前' : `本次记录${turns.length ? ` · ${turns.length}` : ''}`}</button>
    </div>
    {history ? <div className="vg-voice-caption-history" tabIndex={0} aria-label="已确认的本次交流，可滚动回看">
      {turns.length ? turns.map(turn => <div className="vg-voice-caption-turn" key={turn.id}>
        {turn.user && <div className="vg-voice-caption-line"><span className="vg-voice-caption-person">你</span><p>{turn.user}</p></div>}
        {turn.speech && <div className="vg-voice-caption-line"><span className="vg-voice-caption-person">{name}</span><p>{turn.speech}</p></div>}
        {turn.interrupted && <small>已中断 · 仅保留完整播放的台词</small>}
      </div>) : <p className="vg-voice-caption-empty">暂无已完成的对话</p>}
    </div> : <>
      <div className="vg-voice-caption-current" tabIndex={0} aria-label="当前话语，可滚动阅读">
        {view.userText && <div className="vg-voice-caption-line"><span className="vg-voice-caption-person">你</span><p>{view.userText}</p></div>}
        {speech && <div className="vg-voice-caption-line"><span className="vg-voice-caption-person">{name}</span><div><p>{speech}</p>{speaking && <small>正在播放</small>}</div></div>}
        {!hasCurrent && <p className="vg-voice-caption-empty">暂无字幕</p>}
      </div>
    </>}
  </section>;
});
