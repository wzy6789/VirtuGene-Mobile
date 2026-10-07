import { useMemo } from 'react';
import type { MomentNotification } from '../../db';
import type { MomentWithMedia } from '../../db/moments-repo';
import { Avatar } from '../ui/Avatar';

export function MomentsInbox({ count, avatar, onOpen }: { count: number; avatar: string; onOpen: () => void }) {
  if (count <= 0) return null;
  return <div className="vg-moments-inbox-wrap">
    <button type="button" className="vg-moments-inbox" onClick={onOpen} aria-label={`查看 ${count} 条新消息`}>
      <Avatar avatar={avatar} size="sm" className="vg-moments-inbox-avatar" />
      <span>{count > 99 ? '99+' : count} 条新消息</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
    </button>
  </div>;
}

interface InteractionListProps {
  notifications: MomentNotification[];
  posts: MomentWithMedia[];
  actorName: (id?: string) => string;
  actorAvatar: (id?: string) => string;
  timeLabel: (at: number) => string;
  onOpen: (id: string) => void;
}

/** Uses the already loaded feed; opening the inbox does not query each row. */
export function MomentsInteractionList({ notifications, posts, actorName, actorAvatar, timeLabel, onOpen }: InteractionListProps) {
  const byId = useMemo(() => new Map(posts.map(post => [post.moment.id, post])), [posts]);
  if (!notifications.length) return <div className="vg-moments-empty">还没有互动消息。</div>;
  return <div className="vg-moment-notification-list">{notifications.map(item => {
    const post = byId.get(item.momentId);
    const image = post?.media[0]?.dataUrl;
    const name = actorName(item.characterId);
    const preview = item.preview.startsWith(name + ' ') ? item.preview.slice(name.length + 1) : item.preview;
    return <button type="button" className={`vg-moment-notification ${item.read ? '' : 'is-unread'}`} key={item.id} onClick={() => onOpen(item.momentId)}>
      <Avatar avatar={actorAvatar(item.characterId)} size="md" className="vg-moment-notification-avatar" />
      <span className="vg-moment-notification-body">
        <strong>{name}</strong>
        <span className="vg-moment-notification-content">
          {item.type === 'like' && <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>}
          <span>{preview}</span>
        </span>
        <small>{timeLabel(item.createdAt)}</small>
      </span>
      <span className="vg-moment-notification-post" aria-hidden="true">
        {image ? <img src={image} alt="" loading="lazy" /> : <span>{post?.moment.text || (post ? '图片动态' : '动态已不可用')}</span>}
      </span>
    </button>;
  })}</div>;
}
