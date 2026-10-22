import { memo, useMemo, useSyncExternalStore } from 'react';
import type { ChatReplyStream } from '../../lib/chat-stream';
import { MessageBubble } from './MessageBubble';

const emptyParts: string[] = [];
const emptySnapshot = () => emptyParts;
const noSubscription = () => () => {};

// Only the growing part changes on token arrival. Keep completed parts and
// their avatars out of the render path. No message exists until text is visible.
const StreamingPart = memo(function StreamingPart({ stream, avatar, content, index, active }: {
  stream: ChatReplyStream | null; avatar: string; content: string; index: number; active: boolean;
}) {
  const message = useMemo(() => ({ id: stream?.ids[index] ?? 'waiting-reply', sessionId: stream?.sessionId ?? '',
    role: 'assistant' as const, content, createdAt: (stream?.createdAt ?? 0) + index, isProactive: false }), [stream, index, content]);
  return <div className="vg-streaming-part"><MessageBubble avatar={avatar} streaming streamingActive={active} message={message} /></div>;
});

export function StreamingReply({ stream, avatar }: { stream: ChatReplyStream | null; avatar: string }) {
  const parts = useSyncExternalStore(stream?.subscribe ?? noSubscription, stream?.getSnapshot ?? emptySnapshot);
  if (!parts.length) return null;
  return <div className="vg-streaming-reply" role="group" aria-label="正在生成回复" aria-busy aria-live="off" data-streaming-reply>
    {parts.map((content, index) => <StreamingPart key={stream!.ids[index]} stream={stream} avatar={avatar} content={content} index={index} active={index === parts.length - 1} />)}
  </div>;
}
