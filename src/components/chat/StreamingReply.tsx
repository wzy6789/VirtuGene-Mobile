import { memo, useMemo, useSyncExternalStore } from 'react';
import type { ChatReplyStream } from '../../lib/chat-stream';
import { MessageBubble } from './MessageBubble';

const emptyParts: string[] = [];
const emptySnapshot = () => emptyParts;
const noSubscription = () => () => {};

// Only the growing part changes on token arrival. Keep completed parts and
// their avatars out of the render path, while preserving the waiting bubble.
const StreamingPart = memo(function StreamingPart({ stream, avatar, content, index, waiting, active }: {
  stream: ChatReplyStream | null; avatar: string; content: string; index: number; waiting: boolean; active: boolean;
}) {
  const message = useMemo(() => ({ id: stream?.ids[index] ?? 'waiting-reply', sessionId: stream?.sessionId ?? '',
    role: 'assistant' as const, content, createdAt: (stream?.createdAt ?? 0) + index, isProactive: false }), [stream, index, content]);
  return <div className="vg-streaming-part"><MessageBubble avatar={avatar} streaming waiting={waiting} streamingActive={active} message={message} /></div>;
});

export function StreamingReply({ stream, avatar }: { stream: ChatReplyStream | null; avatar: string }) {
  const parts = useSyncExternalStore(stream?.subscribe ?? noSubscription, stream?.getSnapshot ?? emptySnapshot);
  const waiting = parts.length === 0;
  return <div className="vg-streaming-reply" role="group" aria-label="正在生成回复" aria-busy={!waiting} aria-live="off" data-streaming-reply={!waiting || undefined}>
    {(waiting ? [''] : parts).map((content, index) => <StreamingPart key={index === 0 ? 'first' : stream!.ids[index]} stream={stream} avatar={avatar} content={content} index={index} waiting={waiting} active={!waiting && index === parts.length - 1} />)}
  </div>;
}
