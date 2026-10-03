import { useSyncExternalStore } from 'react';
import type { ChatReplyStream } from '../../lib/chat-stream';
import { MessageBubble } from './MessageBubble';

const emptyParts: string[] = [];
const emptySnapshot = () => emptyParts;
const noSubscription = () => () => {};

export function StreamingReply({ stream, avatar }: { stream: ChatReplyStream | null; avatar: string }) {
  const parts = useSyncExternalStore(stream?.subscribe ?? noSubscription, stream?.getSnapshot ?? emptySnapshot);
  const waiting = parts.length === 0;
  return <div className="vg-streaming-reply" role="group" aria-label="正在生成回复" aria-busy={!waiting} aria-live="off" data-streaming-reply={!waiting || undefined}>
    {(waiting ? [''] : parts).map((content, index) => <div className="vg-streaming-part" key={index === 0 ? 'first' : stream!.ids[index]}><MessageBubble avatar={avatar} streaming waiting={waiting}
      streamingActive={!waiting && index === parts.length - 1}
      message={{ id: stream?.ids[index] ?? 'waiting-reply', sessionId: stream?.sessionId ?? '', role: 'assistant', content, createdAt: (stream?.createdAt ?? 0) + index, isProactive: false }} /></div>)}
  </div>;
}
