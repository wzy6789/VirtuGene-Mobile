import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { momentsRepo, type MomentWithMedia } from '../../db/moments-repo';
import {
  AUDIENCE_MODE_LABELS,
  AUDIENCE_MODES,
  DEFAULT_AUDIENCE_PREFERENCE,
  loadAudiencePreference,
  saveAudiencePreference,
  type MomentsAudiencePreference,
} from '../../lib/moments/preferences';
import type { Moment, MomentNotification, MomentReaction } from '../../db/index';
import { Avatar } from '../ui/Avatar';

type AudienceMode = Moment['visibility'];

async function compressImage(file: File): Promise<{ dataUrl: string; width: number; height: number; mime: string }> {
  const sourceUrl = URL.createObjectURL(file);
  const source = typeof createImageBitmap === 'function'
    ? await createImageBitmap(file)
    : await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image:decode'));
      image.src = sourceUrl;
    });
  const scale = Math.min(1, 1200 / Math.max(source.width, source.height));
  let width = Math.max(1, Math.round(source.width * scale));
  let height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(source, 0, 0, width, height);
  let dataUrl = canvas.toDataURL('image/jpeg', 0.72);
  if (dataUrl.length > 600_000) {
    width = Math.max(1, Math.round(width * 0.75));
    height = Math.max(1, Math.round(height * 0.75));
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(source, 0, 0, width, height);
    dataUrl = canvas.toDataURL('image/jpeg', 0.6);
  }
  if ('close' in source && typeof source.close === 'function') source.close();
  URL.revokeObjectURL(sourceUrl);
  return { dataUrl, width, height, mime: 'image/jpeg' };
}

function timeLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function audienceLabel(moment: Moment): string {
  if (moment.visibility === 'private') return '仅自己可见';
  if (moment.visibility === 'selected') return '部分角色可见';
  if (moment.visibility === 'excluded') return '部分角色不可见';
  return '全部角色可见';
}

export function MomentsPage() {
  const userId = useAuthStore((state) => state.userId) ?? '';
  const username = useAuthStore((state) => state.username) ?? '我';
  const avatar = useAuthStore((state) => state.avatar) ?? '🧬';
  const characters = useChatStore((state) => state.characters);
  const [rows, setRows] = useState<MomentWithMedia[]>([]);
  const [contacts, setContacts] = useState<typeof characters>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<AudienceMode>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [images, setImages] = useState<{ dataUrl: string; width: number; height: number; mime: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editingMomentId, setEditingMomentId] = useState<string | null>(null);
  const [editAudience, setEditAudience] = useState<AudienceMode>('all');
  const [editSelected, setEditSelected] = useState<string[]>([]);
  const [reactionMap, setReactionMap] = useState<Record<string, MomentReaction[]>>({});
  const [commenting, setCommenting] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<MomentReaction | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [unreadInteractions, setUnreadInteractions] = useState(0);
  const [notifications, setNotifications] = useState<MomentNotification[]>([]);
  const [notificationSheetOpen, setNotificationSheetOpen] = useState(false);
  const [likesMomentId, setLikesMomentId] = useState<string | null>(null);
  const [detailMomentId, setDetailMomentId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // 右上角「⋯」菜单，以及菜单里的两项设置：朋友圈屏蔽 / 默认可见范围
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [audienceSheetOpen, setAudienceSheetOpen] = useState(false);
  const [audiencePreference, setAudiencePreference] = useState<MomentsAudiencePreference>(DEFAULT_AUDIENCE_PREFERENCE);
  const [prefDraftMode, setPrefDraftMode] = useState<AudienceMode>('all');
  const [prefDraftSelected, setPrefDraftSelected] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const actorName = (characterId?: string) => characterId ? contacts.find((c) => c.id === characterId)?.name ?? '角色' : username;
  const actorAvatar = (characterId?: string) => characterId ? contacts.find((c) => c.id === characterId)?.avatar ?? '✦' : avatar;
  const openNotificationMoment = (momentId: string) => {
    setNotificationSheetOpen(false);
    setDetailMomentId(momentId);
  };

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [nextRows, nextContacts, settings] = await Promise.all([momentsRepo.list(userId), momentsRepo.contacts(userId), momentsRepo.contactSettings(userId)]);
      if (useAuthStore.getState().userId !== userId) return;
      setRows(nextRows);
      setContacts(nextContacts);
      setBlockedIds(settings.filter((item) => item.blocked).map((item) => item.characterId));
      // 前台恢复时处理已到期的角色互动；任务有版本校验，撤回权限不会迟到泄露。
      void momentsRepo.processJobs(userId).then(async () => {
        if (useAuthStore.getState().userId !== userId) return;
        const nextRows = await momentsRepo.list(userId);
        setRows(nextRows);
        setNotifications(await momentsRepo.notifications(userId));
        setUnreadInteractions((await momentsRepo.unreadNotifications(userId)).length);
        setReactionMap(Object.fromEntries(await Promise.all(nextRows.map(async ({ moment }) => [moment.id, await momentsRepo.reactions(moment.id, userId)] as const))));
      }).catch(() => undefined);
      const refreshed = await momentsRepo.list(userId);
      if (useAuthStore.getState().userId !== userId) return;
      setRows(refreshed);
      setUnreadInteractions((await momentsRepo.unreadNotifications(userId)).length);
      setNotifications(await momentsRepo.notifications(userId));
      const pairs = await Promise.all(refreshed.map(async ({ moment }) => [moment.id, await momentsRepo.reactions(moment.id, userId)] as const));
      setReactionMap(Object.fromEntries(pairs));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setRows([]);
    setReactionMap({});
    setNotifications([]);
    setUnreadInteractions(0);
    if (userId) void load();
  }, [userId]);

  useEffect(() => {
    // 换账号要换一套默认可见范围；登出后 userId 为空则回到出厂值。
    const preference = loadAudiencePreference(userId);
    setAudiencePreference(preference);
    setAudience(preference.mode);
    setSelected(preference.contactIds);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          await momentsRepo.processJobs(userId);
          if (useAuthStore.getState().userId !== userId) return;
          const nextRows = await momentsRepo.list(userId);
          setRows(nextRows);
          setUnreadInteractions((await momentsRepo.unreadNotifications(userId)).length);
          setNotifications(await momentsRepo.notifications(userId));
          const pairs = await Promise.all(nextRows.map(async ({ moment }) => [moment.id, await momentsRepo.reactions(moment.id, userId)] as const));
          setReactionMap(Object.fromEntries(pairs));
        } catch {
          // 后台刷新失败不打断用户正在阅读的内容；下次进入页面会再次校验。
        }
      })();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [userId]);

  const selectedNames = useMemo(() => contacts.filter((c) => selected.includes(c.id)).map((c) => c.name), [contacts, selected]);

  /** 互动条上最近互动过的角色（去重、按时间倒序），微信朋友圈那行头像的做法 */
  const recentActorIds = useMemo(() => {
    const seen = new Set<string>();
    for (const item of notifications) {
      if (item.characterId && !seen.has(item.characterId)) seen.add(item.characterId);
      if (seen.size >= 4) break;
    }
    return [...seen];
  }, [notifications]);

  const openAudienceSheet = () => {
    setPrefDraftMode(audiencePreference.mode);
    setPrefDraftSelected(audiencePreference.contactIds);
    setAudienceSheetOpen(true);
  };

  const saveAudienceDefault = () => {
    if (prefDraftMode === 'selected' && prefDraftSelected.length === 0) {
      setToast('「部分可见」需要至少选一个角色，否则发出去谁也看不到。');
      return;
    }
    if (prefDraftMode === 'excluded' && prefDraftSelected.length === 0) {
      setToast('「不给谁看」需要至少选一个角色。');
      return;
    }
    const next: MomentsAudiencePreference = {
      mode: prefDraftMode,
      contactIds: prefDraftMode === 'selected' || prefDraftMode === 'excluded' ? prefDraftSelected : [],
    };
    setAudiencePreference(next);
    saveAudiencePreference(userId, next);
    // 立刻生效：下次打开发布面板就是这个范围，不用重进页面。
    setAudience(next.mode);
    setSelected(next.contactIds);
    setAudienceSheetOpen(false);
    setToast(`新动态默认「${AUDIENCE_MODE_LABELS[next.mode]}」`);
  };

  const closeComposer = () => {
    if (saving) return;
    setComposerOpen(false);
    setText('');
    setImages([]);
    // 收起草稿时回到用户设定的默认可见范围，而不是硬编码的「全部角色」
    setSelected(audiencePreference.contactIds);
    setAudience(audiencePreference.mode);
  };

  const pickImages = async (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files).slice(0, Math.max(0, 9 - images.length));
    try {
      const compressed = await Promise.all(incoming.filter((file) => file.type.startsWith('image/')).map(compressImage));
      setImages((current) => [...current, ...compressed].slice(0, 9));
    } catch {
      setToast('有一张图片没有读好，请重新选择。');
    }
  };

  const publish = async () => {
    if (!userId || saving || (!text.trim() && images.length === 0)) return;
    if (audience === 'selected' && selected.length === 0) {
      setToast('请至少选择一个可以看到的人。');
      return;
    }
    setSaving(true);
    try {
      const moment = await momentsRepo.create(userId, text, { visibility: audience, characterIds: selected }, images.map((image, order) => ({ ...image, order })));
      setRows((current) => [{ moment, media: images.map((image, order) => ({ ...image, id: moment.mediaIds[order], userId, momentId: moment.id, order, createdAt: moment.createdAt })) }, ...current]);
      setReactionMap((current) => ({ ...current, [moment.id]: [] }));
      setSaving(false);
      closeComposer();
      setToast('已发布。角色会按自己的节奏看到它。');
      // 不等待互动，发布本身始终立即完成。
      void momentsRepo.processJobs(userId);
    } catch {
      setToast('这条动态没有保存成功，草稿还在。');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (momentId: string) => {
    await momentsRepo.remove(userId, momentId);
    setRows((current) => current.filter((row) => row.moment.id !== momentId));
    setOpenMenu(null);
  };

  const openAudienceEditor = (moment: Moment) => {
    setEditingMomentId(moment.id);
    setEditAudience(moment.visibility);
    const allIds = contacts.map((contact) => contact.id);
    setEditSelected(moment.visibility === 'excluded'
      ? allIds.filter((id) => !moment.audienceCharacterIds.includes(id))
      : moment.audienceCharacterIds);
    setOpenMenu(null);
  };

  const saveAudienceEdit = async () => {
    if (!userId || !editingMomentId) return;
    if (editAudience === 'selected' && editSelected.length === 0) {
      setToast('部分可见至少需要选择一个角色');
      return;
    }
    await momentsRepo.updateAudience(userId, editingMomentId, { visibility: editAudience, characterIds: editSelected });
    setEditingMomentId(null);
    await load();
    setToast('可见范围已更新，撤回的角色不会再看到这条动态');
  };

  const toggleUserLike = async (momentId: string) => {
    await momentsRepo.toggleLike(userId, momentId);
    const next = await momentsRepo.reactions(momentId, userId);
    setReactionMap((current) => ({ ...current, [momentId]: next }));
  };

  const sendComment = async (momentId: string) => {
    if (commentSaving || !commentDraft.trim()) return;
    setCommentSaving(true);
    try {
      const row = await momentsRepo.addComment(userId, momentId, commentDraft, replyingTo?.id);
      if (!row) return;
      setReactionMap((current) => ({ ...current, [momentId]: [...(current[momentId] ?? []), row] }));
      setCommentDraft('');
      setReplyingTo(null);
      setCommenting(null);
    } catch {
      setToast('评论没有保存成功，文字还在，请重试');
    } finally {
      setCommentSaving(false);
    }
  };

  const openNotifications = () => {
    setNotificationSheetOpen(true);
    if (unreadInteractions > 0) {
      setUnreadInteractions(0);
      void momentsRepo.markNotificationsRead(userId);
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    }
  };

  return (
    <div className="vg-moments-page h-full overflow-y-auto px-4 pb-8">
      <header className="vg-moments-header">
        <div>
          <p className="vg-moments-eyebrow">LIVING NOTES</p>
          <h1>朋友圈</h1>
          <p>把今天留在世界里。</p>
        </div>
        <div className="vg-moments-header-actions">
          <div className="vg-moments-settings-anchor">
            <button
              type="button"
              className="vg-moments-settings"
              onClick={() => setHeaderMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={headerMenuOpen}
              aria-label="朋友圈设置"
            >
              ⋯
            </button>
            {headerMenuOpen && (
              <>
                <button type="button" className="vg-moments-settings-backdrop" aria-label="关闭菜单" onClick={() => setHeaderMenuOpen(false)} />
                <div className="vg-moments-settings-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); setContactSheetOpen(true); }}>朋友圈屏蔽</button>
                  <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); openAudienceSheet(); }}>默认可见范围</button>
                </div>
              </>
            )}
          </div>
          <button type="button" className="vg-moments-camera" onClick={() => setComposerOpen(true)} aria-label="发布动态">＋</button>
        </div>
      </header>

      <section className="vg-moments-profile">
        <div className="vg-moments-cover" />
        <div className="vg-moments-profile-row"><Avatar avatar={avatar} size="lg" /><div><strong>{username}</strong><span>你的生活，在这里有回声</span></div></div>
      </section>

      {/* 互动入口常驻在名片下、动态流上：有新互动显示条数与最近互动者，没有也留一个能翻历史互动的入口 */}
      <button type="button" className="vg-moments-inbox" onClick={openNotifications} aria-label="查看互动消息">
        {recentActorIds.length > 0 ? (
          <span className="vg-moments-inbox-avatars" aria-hidden="true">
            {recentActorIds.map((characterId) => <Avatar key={characterId} avatar={actorAvatar(characterId)} size="sm" />)}
          </span>
        ) : (
          <span className="vg-moments-inbox-mark" aria-hidden="true">✦</span>
        )}
        <span className="vg-moments-inbox-body">
          <strong className={unreadInteractions > 0 ? 'is-unread' : ''}>
            {unreadInteractions > 0 ? `${unreadInteractions > 99 ? '99+' : unreadInteractions} 条新互动` : '互动消息'}
          </strong>
          <small>
            {unreadInteractions > 0
              ? '看看谁在回应你'
              : notifications.length > 0
                ? `最近 ${notifications.length} 条点赞与评论`
                : '角色的点赞和评论会出现在这里'}
          </small>
        </span>
        {unreadInteractions > 0 && <span className="vg-moments-inbox-dot" aria-hidden="true" />}
        <span className="vg-moments-inbox-chevron" aria-hidden="true">›</span>
      </button>

      {loading ? <div className="vg-moments-empty">正在整理最近的生活…</div> : rows.length === 0 ? (
        <div className="vg-moments-empty"><span>✦</span><strong>还没有动态</strong><p>发一张照片，或写下此刻正在发生的事。</p><button type="button" onClick={() => setComposerOpen(true)}>写下第一条</button></div>
      ) : rows.map(({ moment, media }) => {
        const reactions = reactionMap[moment.id] ?? [];
        const likes = reactions.filter((item) => item.type === 'like' && item.status === 'active');
        const comments = reactions.filter((item) => item.type === 'comment' && item.status === 'active');
        const postAuthor = moment.authorCharacterId ? contacts.find((contact) => contact.id === moment.authorCharacterId) : undefined;
        const postAvatar = postAuthor?.avatar ?? avatar;
        const postName = postAuthor?.name ?? username;
        return (
          <article className="vg-moment-card" id={`moment-${moment.id}`} key={moment.id}>
            <div className="vg-moment-author"><Avatar avatar={postAvatar} size="md" /><div><strong>{postName}</strong><span>{timeLabel(moment.createdAt)} · {moment.authorCharacterId ? '角色动态' : audienceLabel(moment)}</span></div>{!moment.authorCharacterId && <button type="button" className="vg-moment-more" onClick={() => setOpenMenu(openMenu === moment.id ? null : moment.id)}>···</button>}</div>
            {openMenu === moment.id && !moment.authorCharacterId && <div className="vg-moment-menu"><button type="button" onClick={() => openAudienceEditor(moment)}>修改谁可以看</button><button type="button" onClick={() => void remove(moment.id)}>删除这条动态</button></div>}
            {moment.text && <p className="vg-moment-text">{moment.text}</p>}
            {media.length > 0 && <div className={`vg-moment-media count-${Math.min(media.length, 9)}`}>{media.map((image) => <button type="button" key={image.id} onClick={() => setPreviewImage(image.dataUrl)} aria-label="查看动态图片"><img src={image.dataUrl} alt="动态图片" loading="lazy" /></button>)}</div>}
            <div className="vg-moment-actions"><button type="button" onClick={() => void toggleUserLike(moment.id)}>{likes.some((like) => !like.characterId) ? '♥ 已赞' : '♡ 赞'}</button><button type="button" onClick={() => { setCommenting(commenting === moment.id ? null : moment.id); setReplyingTo(null); }}>评论{comments.length ? ` ${comments.length}` : ''}</button></div>
            {likes.length > 0 && <button type="button" className="vg-moment-likes" onClick={() => setLikesMomentId(moment.id)} aria-label={`查看全部 ${likes.length} 条点赞`}><span className="vg-moment-like-heart">♥</span><span className="vg-moment-like-avatars">{likes.slice(0, 6).map((like) => <Avatar key={like.id} avatar={actorAvatar(like.characterId)} size="sm" />)}</span><span>共 {likes.length} 人赞</span></button>}
            <div className="vg-moment-comment-section">{comments.length > 0 && <div className="vg-moment-comments">{comments.slice(0, 4).map((comment) => { const target = comments.find((item) => item.id === comment.replyToId); return <button type="button" className="vg-moment-comment-row" key={comment.id} onClick={() => { setCommenting(moment.id); setReplyingTo(comment); }}><strong>{actorName(comment.characterId)}</strong>{target && <> 回复 <strong>{actorName(target.characterId)}</strong></>}：{comment.content}</button>; })}{comments.length > 4 && <button type="button" className="vg-moment-more-comments" onClick={() => setDetailMomentId(moment.id)}>查看全部 {comments.length} 条评论</button>}</div>}
            {commenting === moment.id && <div className="vg-moment-comment-box">{replyingTo && <button type="button" className="vg-moment-replying" onClick={() => setReplyingTo(null)}>回复 {actorName(replyingTo.characterId)} ×</button>}<input autoFocus value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendComment(moment.id); }} placeholder={replyingTo ? `回复 ${actorName(replyingTo.characterId)}…` : '说点什么…'} maxLength={100} /><button type="button" disabled={commentSaving} onClick={() => void sendComment(moment.id)}>{commentSaving ? '发送中' : '发送'}</button></div>}</div>
          </article>
        );
      })}

      {toast && <button type="button" className="vg-moments-toast" onClick={() => setToast(null)}>{toast}</button>}

      {notificationSheetOpen && <div className="vg-moment-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setNotificationSheetOpen(false); }}><section className="vg-moment-sheet vg-moment-notification-sheet"><header><strong>互动消息</strong><button type="button" onClick={() => setNotificationSheetOpen(false)}>完成</button></header>{notifications.length === 0 ? <div className="vg-moments-empty">还没有角色互动。</div> : <div className="vg-moment-notification-list">{notifications.map((item) => <button type="button" className={`vg-moment-notification ${item.read ? '' : 'is-unread'}`} key={item.id} onClick={() => openNotificationMoment(item.momentId)}><Avatar avatar={actorAvatar(item.characterId)} size="sm" /><div><strong>{item.preview}</strong><small>{timeLabel(item.createdAt)}</small></div><span className="vg-moment-notification-mark">{item.type === 'like' ? '♥' : '评'}</span></button>)}</div>}</section></div>}

      {likesMomentId && <div className="vg-moment-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setLikesMomentId(null); }}><section className="vg-moment-sheet"><header><strong>点赞记录</strong><button type="button" onClick={() => setLikesMomentId(null)}>关闭</button></header><div className="vg-moment-like-list">{(reactionMap[likesMomentId] ?? []).filter((item) => item.type === 'like' && item.status === 'active').map((item) => <div key={item.id}><Avatar avatar={actorAvatar(item.characterId)} size="sm" /><strong>{actorName(item.characterId)}</strong><span>{timeLabel(item.createdAt)}</span></div>)}</div></section></div>}

      {detailMomentId && <div className="vg-moment-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setDetailMomentId(null); }}><section className="vg-moment-sheet vg-moment-detail-sheet"><header><strong>动态评论</strong><button type="button" onClick={() => setDetailMomentId(null)}>关闭</button></header><p className="vg-moment-detail-preview">{rows.find((item) => item.moment.id === detailMomentId)?.moment.text || '图片动态'}</p>{(reactionMap[detailMomentId] ?? []).filter((item) => item.type === 'comment' && item.status === 'active').map((item) => { const target = (reactionMap[detailMomentId] ?? []).find((row) => row.id === item.replyToId); return <button type="button" className="vg-moment-detail-comment" key={item.id} onClick={() => { setReplyingTo(item); setCommenting(detailMomentId); setDetailMomentId(null); requestAnimationFrame(() => document.getElementById(`moment-${detailMomentId}`)?.scrollIntoView({ block: 'center' })); }}><Avatar avatar={actorAvatar(item.characterId)} size="sm" /><span><strong>{actorName(item.characterId)}{target ? ` 回复 ${actorName(target.characterId)}` : ''}</strong><span>{item.content}</span><small>{timeLabel(item.createdAt)}</small></span></button>; })}</section></div>}

      {previewImage && <div className="vg-moment-image-overlay" onClick={() => setPreviewImage(null)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Escape') setPreviewImage(null); }}><button type="button" onClick={() => setPreviewImage(null)} aria-label="关闭大图">×</button><img src={previewImage} alt="动态图片大图" /></div>}

      {audienceSheetOpen && <div className="vg-moment-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setAudienceSheetOpen(false); }}><section className="vg-moment-sheet vg-moment-audience-sheet"><header><strong>默认可见范围</strong><button type="button" onClick={() => setAudienceSheetOpen(false)}>取消</button></header><p>新动态默认用这个范围；发布时仍然可以单独改这一条。</p><div className="vg-moment-audience"><span>新动态默认</span><div>{AUDIENCE_MODES.map((mode) => <button type="button" key={mode} className={prefDraftMode === mode ? 'is-selected' : ''} onClick={() => setPrefDraftMode(mode)}>{AUDIENCE_MODE_LABELS[mode]}</button>)}</div>{(prefDraftMode === 'selected' || prefDraftMode === 'excluded') && <div className="vg-moment-contact-picker">{contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={prefDraftSelected.includes(contact.id)} onChange={(event) => setPrefDraftSelected((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} />{contact.name}</label>)}</div>}{prefDraftSelected.length > 0 && (prefDraftMode === 'selected' || prefDraftMode === 'excluded') && <small>{prefDraftMode === 'selected' ? '可见' : '不可见'}：{contacts.filter((c) => prefDraftSelected.includes(c.id)).map((c) => c.name).join('、')}</small>}</div><button type="button" className="vg-moment-publish" onClick={saveAudienceDefault}>保存默认范围</button></section></div>}
      {contactSheetOpen && <div className="vg-moment-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setContactSheetOpen(false); }}><section className="vg-moment-sheet vg-moment-privacy-sheet"><header><strong>朋友圈屏蔽</strong><button type="button" onClick={() => setContactSheetOpen(false)}>完成</button></header><p>被屏蔽的角色不会看到新动态，也不会参与未完成的互动。</p>{contacts.length === 0 ? <div className="vg-moments-empty">还没有可设置的角色。</div> : <div className="vg-moment-block-list">{contacts.map((contact) => <label key={contact.id}><span><Avatar avatar={contact.avatar} size="sm" /><b>{contact.name}</b></span><input type="checkbox" checked={blockedIds.includes(contact.id)} onChange={(event) => { const next = event.target.checked ? [...blockedIds, contact.id] : blockedIds.filter((id) => id !== contact.id); setBlockedIds(next); void momentsRepo.block(userId, contact.id, event.target.checked); }} /></label>)}</div>}</section></div>}

      {editingMomentId && <div className="vg-moment-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditingMomentId(null); }}><section className="vg-moment-sheet vg-moment-edit-sheet"><header><strong>修改谁可以看</strong><button type="button" onClick={() => setEditingMomentId(null)}>取消</button></header><div className="vg-moment-audience"><span>这条动态的可见范围</span><div>{(['all', 'selected', 'excluded', 'private'] as AudienceMode[]).map((mode) => <button type="button" key={mode} className={editAudience === mode ? 'is-selected' : ''} onClick={() => setEditAudience(mode)}>{mode === 'all' ? '全部角色' : mode === 'selected' ? '部分可见' : mode === 'excluded' ? '不给谁看' : '仅自己'}</button>)}</div>{(editAudience === 'selected' || editAudience === 'excluded') && <div className="vg-moment-contact-picker">{contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={editSelected.includes(contact.id)} onChange={(event) => setEditSelected((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} />{contact.name}</label>)}</div>}</div><button type="button" className="vg-moment-publish" onClick={() => void saveAudienceEdit()}>保存可见范围</button></section></div>}

      {composerOpen && <div className="vg-moment-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) closeComposer(); }}><section className="vg-moment-sheet"><header><strong>发布动态</strong><button type="button" onClick={closeComposer}>关闭</button></header><textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="此刻想留下什么？" maxLength={2000} /><div className="vg-moment-preview-grid">{images.map((image, index) => <div key={`${image.dataUrl.slice(0, 20)}-${index}`}><img src={image.dataUrl} alt="待发布图片" /><button type="button" onClick={() => setImages((current) => current.filter((_, item) => item !== index))}>×</button></div>)}<button type="button" className="vg-moment-add-image" onClick={() => fileRef.current?.click()}>＋<span>图片</span></button></div><input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => { void pickImages(event.target.files); event.currentTarget.value = ''; }} /><div className="vg-moment-audience"><span>谁可以看</span><div>{(['all', 'selected', 'excluded', 'private'] as AudienceMode[]).map((mode) => <button type="button" key={mode} className={audience === mode ? 'is-selected' : ''} onClick={() => setAudience(mode)}>{mode === 'all' ? '全部角色' : mode === 'selected' ? '部分可见' : mode === 'excluded' ? '不给谁看' : '仅自己'}</button>)}</div>{(audience === 'selected' || audience === 'excluded') && <div className="vg-moment-contact-picker">{contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={selected.includes(contact.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} />{contact.name}</label>)}</div>}{selectedNames.length > 0 && <small>已选：{selectedNames.join('、')}</small>}</div><button type="button" className="vg-moment-publish" disabled={saving || (!text.trim() && images.length === 0)} onClick={() => void publish()}>{saving ? '保存中…' : '发布'}</button></section></div>}
    </div>
  );
}

export default MomentsPage;
