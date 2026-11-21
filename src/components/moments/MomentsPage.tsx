import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MomentsActionMenu } from './MomentsActionMenu';
import mistLarge from '../../assets/moments/living-mist-960.webp';
import mistSmall from '../../assets/moments/living-mist-480.webp';
import { MomentsInbox, MomentsInteractionList } from './MomentsInteractions';
import { ImagePreview } from '../ui/ImagePreview';
import { useFeedback } from '../../lib/feedback';
import { useAuthStore } from '../../store/auth-store';
import { useUIStore } from '../../store/ui-store';
import { momentsRepo } from '../../db/moments-repo';
import { useMomentsFeed } from './useMomentsFeed';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import {
  AUDIENCE_MODE_LABELS,
  AUDIENCE_MODES,
  DENSITY_LABELS,
  DEFAULT_MOMENTS_PREFERENCES,
  HISTORY_WINDOWS,
  HISTORY_WINDOW_LABELS,
  MOMENT_POST_FREQUENCY_LABELS,
  loadMomentsPreferences,
  saveMomentsPreferences,
  type MomentsAudiencePreference,
  type MomentsDensity,
  type MomentsHistoryWindow,
  type MomentsPreferences,
  type MomentPostFrequency,
} from '../../lib/moments/preferences';
import type { Moment, MomentReaction } from '../../db/index';
import { beginSoulHandoff } from '../../lib/soul-handoff';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import { SettingsChoices, SettingsGroup, SettingsRow, SettingsSwitch } from '../settings/SettingsUI';
import { Icon } from '../ui/Icon';
import '../../styles/moments-ui.css';

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
  const owner = useAuthStore(s => s.userId);
  return owner ? <MomentsPageForUser key={owner} /> : null;
}

function MomentsPageForUser() {
  const lifeRecordFocus = useUIStore(s => s.lifeRecordFocus);
  const userId = useAuthStore((state) => state.userId) ?? '';
  const username = useAuthStore((state) => state.username) ?? '我';
  const avatar = useAuthStore((state) => state.avatar) ?? '🧬';
  const { rows, setRows, contacts, blockedIds, setBlockedIds, mutedIds, setMutedIds, notifications, setNotifications,
    unreadInteractions, setUnreadInteractions, reactionMap, setReactionMap, loading, loaded, loadError, load, processInteractions } = useMomentsFeed(userId);
  const [composerOpen, setComposerOpen] = useState(false);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<AudienceMode>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [images, setImages] = useState<{ dataUrl: string; width: number; height: number; mime: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishError, setPublishError] = useState('');
  useEffect(() => { setPublishError(''); }, [audience, selected]);
  const setToast = useFeedback();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const updateClearCover = useRef<() => void>(() => {});
  const readingFeed = useRef(false);
  // UI retains identifiers only; current authorized reaction rows always supply the text.
  const [commentWindows, setCommentWindows] = useState<Record<string, string[]>>({});
  const pendingComment = useRef<string | null>(null);
  const [discardComposer, setDiscardComposer] = useState(false);
  const [recentPostId, setRecentPostId] = useState<string | null>(null);
  useEffect(() => {
    setCommentWindows(current => {
      const next: Record<string, string[]> = {};
      for (const [id, reactions] of Object.entries(reactionMap)) {
        const comments = reactions.filter(item => item.type === 'comment' && item.status === 'active');
        const retained = readingFeed.current && current[id];
        next[id] = retained ? retained.filter(key => comments.some(item => item.id === key)) : comments.slice(-4).map(item => item.id);
      }
      return next;
    });
    const id = pendingComment.current;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-comment-id="' + CSS.escape(id) + '"]')?.scrollIntoView({ block: 'nearest' });
      pendingComment.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [reactionMap]);
  const [editingMomentId, setEditingMomentId] = useState<string | null>(null);
  const [editAudience, setEditAudience] = useState<AudienceMode>('all');
  const [editSelected, setEditSelected] = useState<string[]>([]);
  const [commenting, setCommenting] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const commentDrafts = useRef<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<MomentReaction | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentMinimized, setCommentMinimized] = useState(false);
  useEffect(() => {
    const minimize = () => setCommentMinimized(true);
    window.addEventListener('vg:keyboard-dismissed', minimize);
    return () => window.removeEventListener('vg:keyboard-dismissed', minimize);
  }, []);
  useEffect(() => { setCommentMinimized(false); }, [commenting, replyingTo]);
  const openComment = (momentId: string, reply: MomentReaction | null) => {
    setOpenMenu(null); setInteractMomentId(null);
    if (commenting && commenting !== momentId) commentDrafts.current[commenting] = commentDraft;
    if (commenting !== momentId) setCommentDraft(commentDrafts.current[momentId] ?? '');
    setCommentMinimized(false);
    setCommenting(momentId);
    setReplyingTo(reply);
  };
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [notificationSheetOpen, setNotificationSheetOpen] = useState(false);
  const [likesMomentId, setLikesMomentId] = useState<string | null>(null);
  const [detailMomentId, setDetailMomentId] = useState<string | null>(null);
  useEffect(() => {
    if (lifeRecordFocus?.kind !== 'moments') return;
    if (lifeRecordFocus.userId !== userId) {
      useUIStore.setState({ lifeRecordFocus: null });
      return;
    }
    if (loading) return;
    document.getElementById(`moment-${lifeRecordFocus.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    useUIStore.setState({ lifeRecordFocus: null });
  }, [lifeRecordFocus, userId, loading, rows]);
  const [previewImage, setPreviewImage] = useState<{ images: string[]; keys: string[]; index: number; owner: string } | null>(null);
  useEffect(() => { setPreviewImage(null); }, [userId]);
  // 右上角设置入口直接打开总设置；细项在同一面板内查找。
  const [audienceSheetOpen, setAudienceSheetOpen] = useState(false);
  const [preferences, setPreferences] = useState<MomentsPreferences>(DEFAULT_MOMENTS_PREFERENCES);
  const [prefDraftMode, setPrefDraftMode] = useState<AudienceMode>('all');
  const [prefDraftSelected, setPrefDraftSelected] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRequested = useUIStore(s => s.momentsSettingsRequested);
  useEffect(() => {
    if (settingsRequested) { setSettingsOpen(true); useUIStore.getState().setMomentsSettingsRequested(false); }
  }, [settingsRequested]);
  const [mutedSheetOpen, setMutedSheetOpen] = useState(false);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [deleteComment, setDeleteComment] = useState<{ momentId: string; reactionId: string } | null>(null);
  const [coverExpanded, setCoverExpanded] = useState(false);
  const coverSurface = useRef<HTMLButtonElement>(null);
  const coverMotion = useRef<Animation | null>(null);
  const oldCoverHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const cover = coverSurface.current, feed = feedRef.current, glass = glassRef.current;
    if (!cover || !feed || !glass) return;
    let height = cover.getBoundingClientRect().height, frame = 0, previous = -1;
    const sync = () => {
      frame = 0;
      const clear = Math.max(0, height - feed.scrollTop);
      if (clear === previous) return;
      previous = clear;
      glass.style.setProperty('--moments-clear-top', `${clear}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const observer = new ResizeObserver(entries => {
      height = entries[0].contentRect.height;
      schedule();
    });
    observer.observe(cover);
    updateClearCover.current = schedule;
    sync();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); updateClearCover.current = () => {}; };
  }, []);
  useLayoutEffect(() => {
    const node = coverSurface.current, height = oldCoverHeight.current;
    oldCoverHeight.current = null;
    if (!node || height == null || matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.vgReducedMotion === 'true') return;
    // A short, bounded cover resize, never a transform/blur on the long feed.
    const next = node.getBoundingClientRect().height;
    if (Math.abs(next - height) < .5) return;
    coverMotion.current = node.animate([{ height: `${height}px`, aspectRatio: 'auto' }, { height: `${next}px`, aspectRatio: 'auto' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    return () => { coverMotion.current?.cancel(); coverMotion.current = null; };
  }, [coverExpanded]);
  /** 微信那套：每条动态右下角一个「···」气泡，点开才浮出 赞 | 评论 */
  const [interactMomentId, setInteractMomentId] = useState<string | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const commentLongPressTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    if (commentLongPressTimer.current) window.clearTimeout(commentLongPressTimer.current);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const actorName = (characterId?: string) => characterId ? contacts.find((c) => c.id === characterId)?.name ?? '角色' : username;
  const actorAvatar = (characterId?: string) => characterId ? contacts.find((c) => c.id === characterId)?.avatar ?? '✦' : avatar;
  /**
   * 「回复 X」只在真的换了说话人时显示，返回要显示的名字，否则 null。
   * 用户自己的评论没有 characterId：如果回复对象也是用户，两边都会回落成用户名，
   * 屏上就会出现「旅人 回复 旅人」这种没人看得懂的行。
   */
  const replyTargetName = (comment: MomentReaction, target?: MomentReaction): string | null =>
    target && target.characterId !== comment.characterId ? actorName(target.characterId) : null;
  const openNotificationMoment = (momentId: string) => {
    if (!rows.some(row => row.moment.id === momentId)) {
      setToast('这条动态已删除或暂时不可见');
      return;
    }
    setNotificationSheetOpen(false);
    setDetailMomentId(momentId);
  };

  useEffect(() => {
    // 换账号要换一套朋友圈偏好；登出后 userId 为空则回到出厂值。
    const loaded = loadMomentsPreferences(userId);
    setPreferences(loaded);
    setAudience(loaded.audience.mode);
    setSelected(loaded.audience.contactIds);
  }, [userId]);

  const selectedNames = useMemo(() => contacts.filter((c) => selected.includes(c.id)).map((c) => c.name), [contacts, selected]);

  // The entry shows the latest unread actor, rather than a stack of old actors.
  const newestInteraction = notifications.find(item => !item.read) ?? notifications[0];

  /** 改一条偏好就落一次盘，保证「设置面板里调完立刻生效」 */
  const applyPreferences = (patch: Partial<MomentsPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      saveMomentsPreferences(userId, next);
      return next;
    });
  };

  const toggleCover = () => {
    oldCoverHeight.current = coverSurface.current?.getBoundingClientRect().height ?? null;
    coverMotion.current?.cancel();
    setCoverExpanded(open => !open);
  };

  const toggleMute = (characterId: string, muted: boolean) => {
    setMutedIds((current) => (muted ? [...current, characterId] : current.filter((id) => id !== characterId)));
    void momentsRepo.setMuted(userId, characterId, muted);
  };

  /** 长按自己的动态才出管理菜单（微信是长按自己的动态删除），别人的动态不响应 */
  const startPostLongPress = (momentId: string, own: boolean, anchor: HTMLElement) => {
    if (!own) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      menuAnchor.current = anchor; setInteractMomentId(null); setOpenMenu(momentId);
    }, 450);
  };
  const cancelPostLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  /** 长按自己的评论 → 删除（微信也是长按自己的评论删） */
  const startCommentLongPress = (momentId: string, reactionId: string, mine: boolean) => {
    if (!mine) return;
    if (commentLongPressTimer.current) window.clearTimeout(commentLongPressTimer.current);
    commentLongPressTimer.current = window.setTimeout(() => {
      commentLongPressTimer.current = null;
      setDeleteComment({ momentId, reactionId });
    }, 450);
  };
  const cancelCommentLongPress = () => {
    if (commentLongPressTimer.current) {
      window.clearTimeout(commentLongPressTimer.current);
      commentLongPressTimer.current = null;
    }
  };

  const confirmDeleteComment = async () => {
    if (!deleteComment) return;
    const { momentId, reactionId } = deleteComment;
    let ok: boolean;
    try { ok = await momentsRepo.deleteOwnComment(userId, reactionId); }
    catch { setToast('评论未能删除，请重试', { tone: 'error' }); return; }
    setDeleteComment(null);
    if (!ok) {
      setToast('这条评论已经删过了。');
      return;
    }
    setReactionMap((current) => ({
      ...current,
      [momentId]: (current[momentId] ?? []).map((row) => (row.id === reactionId ? { ...row, status: 'deleted' as const } : row)),
    }));
    setToast('评论已删除', { tone: 'success' });
  };

  const markAllRead = async () => {
    await momentsRepo.markNotificationsRead(userId);
    setUnreadInteractions(0);
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    setToast('互动消息已全部标记为已读');
  };

  const clearNotifications = async () => {
    try { await momentsRepo.clearNotifications(userId); }
    catch { setToast('互动记录未能清空，请重试', { tone: 'error' }); return; }
    setNotifications([]);
    setUnreadInteractions(0);
    setToast('互动消息记录已清空，动态与评论保留', { tone: 'success' });
  };

  const openAudienceSheet = () => {
    setPrefDraftMode(preferences.audience.mode);
    setPrefDraftSelected(preferences.audience.contactIds);
    setAudienceSheetOpen(true);
  };

  /** 「不看他（她）的朋友圈」：只过滤我这边的动态流，自己的动态永远显示 */
  const visibleRows = useMemo(
    () => rows.filter((row) => !row.moment.authorCharacterId || !mutedIds.includes(row.moment.authorCharacterId)),
    [rows, mutedIds],
  );

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
    applyPreferences({ audience: next });
    // 立刻生效：下次打开发布面板就是这个范围，不用重进页面。
    setAudience(next.mode);
    setSelected(next.contactIds);
    setAudienceSheetOpen(false);
    setToast(`新动态默认「${AUDIENCE_MODE_LABELS[next.mode]}」`);
  };

  const closeComposer = () => {
    if (saving) return;
    setComposerOpen(false);
    setPublishError('');
    setText('');
    setImages([]);
    // 收起草稿时回到用户设定的默认可见范围，而不是硬编码的「全部角色」
    setSelected(preferences.audience.contactIds);
    setAudience(preferences.audience.mode);
  };

  const requestCloseComposer = () => {
    if (saving) return;
    if (text.trim() || images.length) setDiscardComposer(true);
    else closeComposer();
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

  const pickCover = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      // 复用发图的压缩管线：封面也存成 dataURL，和头像一样只落在本机
      const compressed = await compressImage(file);
      applyPreferences({ cover: compressed.dataUrl });
      setCoverExpanded(true);
    } catch {
      setToast('这张封面没有读好，请换一张。');
    }
  };

  const publish = async () => {
    if (!userId || saving || (!text.trim() && images.length === 0)) return;
    if (audience === 'selected' && selected.length === 0) {
      setPublishError('请至少选择一个可以看到的人。');
      return;
    }
    setPublishError('');
    setSaving(true);
    try {
      const moment = await momentsRepo.create(userId, text, { visibility: audience, characterIds: selected }, images.map((image, order) => ({ ...image, order })));
      setRows((current) => [{ moment, media: images.map((image, order) => ({ ...image, id: moment.mediaIds[order], userId, momentId: moment.id, order, createdAt: moment.createdAt })) }, ...current.filter(row => row.moment.id !== moment.id)]);
      setReactionMap((current) => ({ ...current, [moment.id]: [] }));
      setRecentPostId(moment.id);
      feedRef.current?.scrollTo({ top: 0 });
      setSaving(false);
      closeComposer();
      if (preferences.notifyAfterPublish) setToast(moment.visibility === 'private' ? '已发布，仅自己可见。' : '已发布，可见范围已保存。', { tone: 'success' });
      // 不等待互动，发布本身始终立即完成。
      void processInteractions();
    } catch {
      setPublishError('这条动态没有保存成功，草稿还在。');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (momentId: string) => {
    try {
      await momentsRepo.remove(userId, momentId);
      setRows((current) => current.filter((row) => row.moment.id !== momentId));
      setOpenMenu(null);
      setToast('动态已删除', { tone: 'success' });
    } catch { setToast('动态未能删除，请重试', { tone: 'error' }); }
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
      setCommentWindows(current => ({ ...current, [momentId]: [...(reactionMap[momentId] ?? []).filter(item => item.type === 'comment' && item.status === 'active'), row].slice(-4).map(item => item.id) }));
      pendingComment.current = row.id;
      delete commentDrafts.current[momentId];
      setCommentDraft('');
      setReplyingTo(null);
      setCommenting(null);
    } catch {
      setToast('评论没有保存成功，文字还在，请重试', { tone: 'error' });
    } finally {
      setCommentSaving(false);
    }
  };

  const readingNotifications = useRef(false);
  const openNotifications = async () => {
    setNotificationSheetOpen(true);
    if (unreadInteractions <= 0 || readingNotifications.current) return;
    readingNotifications.current = true;
    try {
      await momentsRepo.markNotificationsRead(userId);
      const [nextNotifications, unread] = await Promise.all([momentsRepo.notifications(userId), momentsRepo.unreadNotifications(userId)]);
      if (useAuthStore.getState().userId !== userId) return;
      setNotifications(nextNotifications);
      setUnreadInteractions(unread.length);
    } catch {
      if (useAuthStore.getState().userId === userId) setToast('消息已打开，但已读状态未保存，请稍后重试', { tone: 'error' });
    } finally { readingNotifications.current = false; }
  };

  return (
    <div className="vg-moments-page vg-moments-living-mist" data-density={preferences.density}>
      <div className="vg-moments-backdrop" aria-hidden="true"><img src={mistLarge} srcSet={mistSmall + ' 480w, ' + mistLarge + ' 960w'} sizes="100vw" alt="" fetchPriority="low" /></div>
      <header className="vg-moments-header">
        <div>
          <h1>朋友圈</h1>

        </div>
        <div className="vg-moments-header-actions">
          <button type="button" className="vg-moments-settings" onClick={() => setSettingsOpen(true)} aria-label="朋友圈设置">
            <Icon name="gear" size={20} />
          </button>
          <button type="button" className="vg-moments-camera" onClick={() => setComposerOpen(true)} aria-label="发布动态">
            <Icon name="plus" size={20} />
          </button>
        </div>
      </header>

      <div className="vg-moments-workplane" ref={glassRef}><div className="vg-moments-feed" ref={feedRef} onScroll={event => { readingFeed.current = event.currentTarget.scrollTop > 24; updateClearCover.current(); }} aria-label="朋友圈动态">
      <section className="vg-moments-profile" data-expanded={coverExpanded} data-has-cover={!!preferences.cover}>
        <button
          type="button"
          className="vg-moments-cover"
          ref={coverSurface}
          onClick={toggleCover}
          aria-expanded={coverExpanded}
          aria-label={preferences.cover ? coverExpanded ? '收起朋友圈封面' : '展开朋友圈封面' : coverExpanded ? '收起封面设置' : '封面设置'}
        >
          {preferences.cover && <img src={preferences.cover} alt="" className="vg-moments-cover-image" onLoad={(event) => {
            const image = event.currentTarget;
            image.dataset.portrait = String(image.naturalHeight > image.naturalWidth);
          }} />}
        </button>
        <div className="vg-moments-profile-row"><Avatar avatar={avatar} size="lg" /><div><strong>{username}</strong></div></div>
        {coverExpanded && (
          <div className="vg-moments-cover-actions">
            <button type="button" onClick={() => coverRef.current?.click()}>更换封面</button>
            {preferences.cover && <button type="button" onClick={() => applyPreferences({ cover: '' })}>恢复默认</button>}
          </div>
        )}
        <input ref={coverRef} type="file" accept="image/*" hidden onChange={(event) => { void pickCover(event.target.files); event.currentTarget.value = ''; }} />
      </section>

      {/* 只在有未读互动时占用动态流位置；看过后收起，历史仍可从设置查看。 */}
      <MomentsInbox count={unreadInteractions} avatar={newestInteraction ? actorAvatar(newestInteraction.characterId) : '✦'} onOpen={() => void openNotifications()} />
      {loadError && <FeedbackNotice className="mx-4 mb-4" message={loadError} tone="error"><button type="button" className="vg-button vg-button-secondary" aria-label="重新读取动态" onClick={() => void load()}>重新读取</button></FeedbackNotice>}
      {loading && (loaded || visibleRows.length > 0) && <p className="mx-4 mb-4 text-sm text-sub" role="status">正在更新动态…</p>}
      {!loaded && visibleRows.length === 0 ? loading ? <div className="vg-moments-loading" role="status" aria-label="正在读取动态">{[0, 1, 2].map(index => <div className="vg-moments-loading-row" key={index}><i /><div><span /><span /><b /></div></div>)}</div> : null : visibleRows.length === 0 ? (
        <div className="vg-moments-empty"><span><Icon name="spark" size={32} /></span><strong>还没有动态</strong><button type="button" onClick={() => setComposerOpen(true)}>发布动态</button></div>
      ) : visibleRows.map(({ moment, media }) => {
        const reactions = reactionMap[moment.id] ?? [];
        const likes = reactions.filter((item) => item.type === 'like' && item.status === 'active');
        const comments = reactions.filter((item) => item.type === 'comment' && item.status === 'active');
        const windowIds = commentWindows[moment.id];
        const shownComments = windowIds ? comments.filter(item => windowIds.includes(item.id)) : comments.slice(-4);
        const postAuthor = moment.authorCharacterId ? contacts.find((contact) => contact.id === moment.authorCharacterId) : undefined;
        const postAvatar = postAuthor?.avatar ?? avatar;
        const postName = postAuthor?.name ?? username;
        const own = !moment.authorCharacterId;
        const liked = likes.some((like) => !like.characterId);
        const pillOpen = interactMomentId === moment.id;
        return (
          <article
            className={`vg-moment-card${recentPostId === moment.id ? ' is-new-post' : ''}`}
            id={`moment-${moment.id}`}
            key={moment.id}
            onContextMenu={(event) => { if (own && !event.defaultPrevented && !(event.target as HTMLElement).closest('button,input,textarea,select')) { event.preventDefault(); menuAnchor.current = event.currentTarget; setInteractMomentId(null); setOpenMenu(moment.id); } }}
            onTouchStart={(event) => { if (!(event.target as HTMLElement).closest('button,input,textarea,select')) startPostLongPress(moment.id, own, event.currentTarget); }}
            onTouchEnd={cancelPostLongPress}
            onTouchMove={cancelPostLongPress}
            onTouchCancel={cancelPostLongPress}
          >
            <Avatar avatar={postAvatar} size="md" />
            <div className="vg-moment-body">
              <strong className="vg-moment-name">{postName}</strong>
              {moment.text && <p className="vg-moment-text">{moment.text}</p>}
              {media.length > 0 && <div className={`vg-moment-media count-${Math.min(media.length, 9)}`}>{media.map((image, index) => <button type="button" key={image.id} onClick={event => { beginSoulHandoff(`media:${image.id}`,event.currentTarget.querySelector('img'),'media'); setPreviewImage({ images: media.map(item => item.dataUrl), keys: media.map(item=>`media:${item.id}`), index, owner: userId }); }} aria-label="查看动态图片"><img src={image.dataUrl} alt="动态图片" loading="lazy" decoding="async" width={image.width} height={image.height} onError={event => { event.currentTarget.classList.add('is-unavailable'); }} /></button>)}</div>}
              {moment.lifeThreadId && visibleRows.some((row) => row.moment.lifeThreadId === moment.lifeThreadId && row.moment.createdAt > moment.createdAt) && (
                  <button type="button" className="vg-moment-thread-link" onClick={() => {
                    const next = visibleRows.filter((row) => row.moment.lifeThreadId === moment.lifeThreadId && row.moment.createdAt > moment.createdAt)
                      .sort((a, b) => a.moment.createdAt - b.moment.createdAt)[0];
                    if (next) document.getElementById(`moment-${next.moment.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}>这件事还有后续</button>
                )}

              {openMenu === moment.id && own && <MomentsActionMenu anchor={menuAnchor.current} onClose={() => setOpenMenu(null)} label="动态管理" className="is-management"><button type="button" role="menuitem" onClick={() => openAudienceEditor(moment)}>修改谁可以看</button><button type="button" role="menuitem" onClick={() => void remove(moment.id)}>删除这条动态</button></MomentsActionMenu>}

              <div className="vg-moment-interact">
                <div className="vg-moment-meta"><span>{timeLabel(moment.createdAt)}</span><span>{moment.authorCharacterId ? '角色动态' : audienceLabel(moment)}</span></div>
                <button
                  type="button"
                  className={`vg-moment-bubble ${liked ? 'is-liked' : ''}`}
                  onClick={event => { menuAnchor.current = event.currentTarget; setOpenMenu(null); setInteractMomentId(pillOpen ? null : moment.id); }}
                  aria-haspopup="menu"
                  aria-expanded={pillOpen}
                  aria-label="赞或评论"
                >
                  <Icon name="more" size={20} />
                </button>
                {pillOpen && (
                  <MomentsActionMenu anchor={menuAnchor.current} onClose={() => setInteractMomentId(null)} label="动态互动" className="is-interaction">
                    <button type="button" role="menuitem" aria-label={liked ? '取消点赞' : '点赞'} onClick={() => { void toggleUserLike(moment.id); setInteractMomentId(null); }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3Zm0 0 4-7a3 3 0 0 1 2.8 3L13 10h5a2 2 0 0 1 2 2l-1.5 7a2 2 0 0 1-2 1.7H7" /></svg>
                      <span>{liked ? '取消赞' : '赞'}</span>
                    </button>
                    <button type="button" role="menuitem" aria-label="评论" onClick={() => { openComment(moment.id, null); setInteractMomentId(null); }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-3.5-.7L4 20l1.5-3.5A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>
                      <span>评论</span>
                    </button>
                  </MomentsActionMenu>
                )}
              </div>

              {(likes.length > 0 || comments.length > 0) && (
                <div className="vg-moment-thread">
                  {likes.length > 0 && <button type="button" className="vg-moment-likes" onClick={() => setLikesMomentId(moment.id)} aria-label="查看点赞记录"><span className="vg-moment-like-heart" aria-hidden="true"><Icon name="heart" size={16} /></span><span className="vg-moment-like-avatars">{likes.slice(0, 6).map((like) => <Avatar key={like.id} avatar={actorAvatar(like.characterId)} size="sm" />)}</span></button>}
                  {comments.length > 0 && <div className="vg-moment-comments">{shownComments.map((comment) => { const target = comments.find((item) => item.id === comment.replyToId); const targetName = replyTargetName(comment, target); const mine = !comment.characterId; return <button type="button" className={`vg-moment-comment-row ${mine ? 'is-mine' : ''}`} key={comment.id} data-comment-id={comment.id} onClick={() => { openComment(moment.id, comment); }} onContextMenu={(event) => { if (!mine) return; event.preventDefault(); setDeleteComment({ momentId: moment.id, reactionId: comment.id }); }} onTouchStart={() => startCommentLongPress(moment.id, comment.id, mine)} onTouchEnd={cancelCommentLongPress} onTouchMove={cancelCommentLongPress}><strong>{actorName(comment.characterId)}</strong>{targetName && <> 回复 <strong>{targetName}</strong></>}：{comment.content}</button>; })}{comments.length > 4 && <button type="button" className="vg-moment-more-comments" onClick={() => setDetailMomentId(moment.id)}>查看全部 {comments.length} 条评论</button>}</div>}
                </div>
              )}

              {commenting === moment.id && (commentMinimized ? <button type="button" className="vg-moment-more-comments" onClick={() => setCommentMinimized(false)}>{commentDraft.trim() ? '继续评论 · 草稿已保留' : '继续评论'}</button> : <div className="vg-moment-comment-box">{replyingTo && <button type="button" className="vg-moment-replying" onClick={() => setReplyingTo(null)}>回复 {actorName(replyingTo.characterId)} ×</button>}<input className="vg-text-field" aria-label="评论内容" autoFocus value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void sendComment(moment.id); }} placeholder={replyingTo ? `回复 ${actorName(replyingTo.characterId)}…` : '说点什么…'} maxLength={100} /><button type="button" disabled={commentSaving} onClick={() => void sendComment(moment.id)}>{commentSaving ? '发送中' : '发送'}</button></div>)}
            </div>
          </article>
        );
      })}


      </div></div>

      {notificationSheetOpen && <Modal open panelClassName="vg-moments-panel" title="互动消息" onClose={() => setNotificationSheetOpen(false)} canSnapshotOnExit={() => useAuthStore.getState().userId === userId}><section className="vg-moment-sheet vg-moment-notification-sheet"><MomentsInteractionList notifications={notifications} posts={rows} actorName={actorName} actorAvatar={actorAvatar} timeLabel={timeLabel} onOpen={openNotificationMoment} /></section></Modal>}

      {likesMomentId && <Modal open panelClassName="vg-moments-panel" title="点赞记录" onClose={() => setLikesMomentId(null)} canSnapshotOnExit={() => useAuthStore.getState().userId === userId}><section className="vg-moment-sheet"><div className="vg-moment-like-list">{(reactionMap[likesMomentId] ?? []).filter((item) => item.type === 'like' && item.status === 'active').map((item) => <div key={item.id}><Avatar avatar={actorAvatar(item.characterId)} size="sm" /><strong>{actorName(item.characterId)}</strong><span>{timeLabel(item.createdAt)}</span></div>)}</div></section></Modal>}

      {detailMomentId && <Modal open panelClassName="vg-moments-panel" title="动态评论" onClose={() => setDetailMomentId(null)} canSnapshotOnExit={() => useAuthStore.getState().userId === userId}><section className="vg-moment-sheet vg-moment-detail-sheet"><p className="vg-moment-detail-preview">{rows.find((item) => item.moment.id === detailMomentId)?.moment.text || '图片动态'}</p>{(reactionMap[detailMomentId] ?? []).filter((item) => item.type === 'comment' && item.status === 'active').map((item) => { const target = (reactionMap[detailMomentId] ?? []).find((row) => row.id === item.replyToId); return <button type="button" className="vg-moment-detail-comment" key={item.id} onClick={() => { openComment(detailMomentId, item); setDetailMomentId(null); requestAnimationFrame(() => document.getElementById(`moment-${detailMomentId}`)?.scrollIntoView({ block: 'center' })); }}><Avatar avatar={actorAvatar(item.characterId)} size="sm" /><span><strong>{actorName(item.characterId)}{replyTargetName(item, target) ? ` 回复 ${replyTargetName(item, target)}` : ''}</strong><span>{item.content}</span><small>{timeLabel(item.createdAt)}</small></span></button>; })}</section></Modal>}

      {previewImage?.owner === userId && <ImagePreview images={previewImage.images} soulKeys={previewImage.keys} initialIndex={previewImage.index} onClose={() => setPreviewImage(null)} />}

      <Modal open={audienceSheetOpen} onClose={() => setAudienceSheetOpen(false)} onBack={() => { setAudienceSheetOpen(false); setSettingsOpen(true); }} title="默认可见范围" mobileFullHeight panelClassName="vg-settings-panel vg-moments-panel" footer={<div className="vg-settings-design !py-3"><button type="button" className="vg-moment-publish" onClick={saveAudienceDefault}>保存默认范围</button></div>}><div className="vg-settings-design vg-moment-settings-detail vg-moment-audience-sheet"><p>仅影响新动态，发布时可单独修改。</p><div className="vg-moment-audience"><div>{AUDIENCE_MODES.map((mode) => <button type="button" key={mode} className={prefDraftMode === mode ? 'is-selected' : ''} onClick={() => setPrefDraftMode(mode)}>{AUDIENCE_MODE_LABELS[mode]}</button>)}</div>{(prefDraftMode === 'selected' || prefDraftMode === 'excluded') && <div className="vg-moment-contact-picker">{contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={prefDraftSelected.includes(contact.id)} onChange={(event) => setPrefDraftSelected((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} />{contact.name}</label>)}</div>}{prefDraftSelected.length > 0 && (prefDraftMode === 'selected' || prefDraftMode === 'excluded') && <small>{prefDraftMode === 'selected' ? '可见' : '不可见'}：{contacts.filter((c) => prefDraftSelected.includes(c.id)).map((c) => c.name).join('、')}</small>}</div></div></Modal>
      <Modal open={contactSheetOpen} onClose={() => setContactSheetOpen(false)} onBack={() => { setContactSheetOpen(false); setSettingsOpen(true); }} title="朋友圈屏蔽" mobileFullHeight panelClassName="vg-settings-panel vg-moments-panel"><div className="vg-settings-design vg-moment-settings-detail vg-moment-privacy-sheet"><p>被屏蔽的角色不会看到新动态，也不会参与未完成的互动。</p>{contacts.length === 0 ? <div className="vg-moments-empty">还没有可设置的角色。</div> : <div className="vg-moment-block-list">{contacts.map((contact) => <label key={contact.id}><span><Avatar avatar={contact.avatar} size="sm" /><b>{contact.name}</b></span><input type="checkbox" checked={blockedIds.includes(contact.id)} onChange={(event) => { const next = event.target.checked ? [...blockedIds, contact.id] : blockedIds.filter((id) => id !== contact.id); setBlockedIds(next); void momentsRepo.block(userId, contact.id, event.target.checked); }} /></label>)}</div>}</div></Modal>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="朋友圈设置" mobileFullHeight panelClassName="vg-settings-panel vg-moments-panel">
        <div className="vg-settings-design vg-moment-preferences vg-moment-settings-sheet">

          <SettingsGroup title="消息与提醒" scope="当前账号">
            <SettingsRow title="互动消息" icon="account" value={unreadInteractions > 0 ? `${unreadInteractions} 条未读` : `${notifications.length} 条记录`} onClick={() => { setSettingsOpen(false); openNotifications(); }} />
            <SettingsSwitch title="世界入口未读提示" checked={preferences.showUnreadBadge} onChange={value => applyPreferences({ showUnreadBadge: value })} />
            <SettingsSwitch title="发布后提示" checked={preferences.notifyAfterPublish} onChange={value => applyPreferences({ notifyAfterPublish: value })} />
            <div className="vg-moment-setting-actions"><button type="button" disabled={unreadInteractions === 0} onClick={() => void markAllRead()}>全部已读</button><button type="button" disabled={notifications.length === 0} onClick={() => void clearNotifications()}>清空记录</button></div>
          </SettingsGroup>
          <SettingsGroup title="好友分享">
            <SettingsSwitch title="允许好友主动分享" detail="会调用模型生成好友动态。" checked={preferences.autonomousPostsEnabled} onChange={value => applyPreferences({ autonomousPostsEnabled: value })} />
            <p className="vg-settings-intro px-4 pt-3 mb-0">分享节奏</p>
            <SettingsChoices label="默认分享节奏" value={preferences.postFrequency} onChange={value => applyPreferences({ postFrequency: value })} options={[{ value: 'quiet', title: MOMENT_POST_FREQUENCY_LABELS.quiet, detail: '约两天分享一次' }, { value: 'natural', title: MOMENT_POST_FREQUENCY_LABELS.natural, detail: '约一天分享一次' }, { value: 'active', title: MOMENT_POST_FREQUENCY_LABELS.active, detail: '约半天分享一次' }]} />
        <details className="vg-moment-post-contact-settings">
          <summary>单独调整好友</summary>
          {contacts.length === 0 ? <p>还没有可设置的角色。</p> : contacts.map((contact) => {
            const mode = preferences.contactPostModes[contact.id] ?? preferences.postFrequency;
            return <div className="vg-moment-post-contact" key={contact.id}><span><Avatar avatar={contact.avatar} size="sm" /><b>{contact.name}</b></span><select aria-label={`${contact.name}的分享节奏`} value={mode} onChange={(event) => {
              const selectedMode = event.target.value as MomentPostFrequency;
              const nextModes = { ...preferences.contactPostModes };
              if (selectedMode === preferences.postFrequency) delete nextModes[contact.id];
              else nextModes[contact.id] = selectedMode;
              applyPreferences({ contactPostModes: nextModes });
            }}>{(['quiet', 'natural', 'active'] as MomentPostFrequency[]).map((item) => <option value={item} key={item}>{MOMENT_POST_FREQUENCY_LABELS[item]}</option>)}</select></div>;
          })}
        </details>
          </SettingsGroup>
          <SettingsGroup title="可见与屏蔽">
            <SettingsRow title="不让谁看我的朋友圈" icon="privacy" value={blockedIds.length ? `${blockedIds.length} 位` : '未设置'} detail="屏蔽对方查看你的新动态" onClick={() => { setSettingsOpen(false); setContactSheetOpen(true); }} />
            <SettingsRow title="不看他（她）的朋友圈" icon="account" value={mutedIds.length ? `${mutedIds.length} 位` : '未设置'} detail="只调整你看到的动态" onClick={() => { setSettingsOpen(false); setMutedSheetOpen(true); }} />
            <SettingsRow title="允许角色查看我的历史动态" icon="clock" value={HISTORY_WINDOW_LABELS[preferences.historyWindow]} onClick={() => { setSettingsOpen(false); setHistorySheetOpen(true); }} />
          </SettingsGroup>
          <SettingsGroup title="展示">

        <button type="button" className="vg-moment-setting-row" onClick={() => { setSettingsOpen(false); openAudienceSheet(); }}><span>默认可见范围<small>{AUDIENCE_MODE_LABELS[preferences.audience.mode]}</small></span></button>

        
        <div className="vg-moment-setting-row is-static"><span>朋友圈封面<small>{preferences.cover ? '已自定义' : '生命星雾'}</small></span><span className="vg-moment-setting-buttons"><button type="button" onClick={() => coverRef.current?.click()}>更换</button>{preferences.cover && <button type="button" onClick={() => applyPreferences({ cover: '' })}>恢复默认</button>}</span></div>
        <div className="vg-moment-setting-row is-static"><span>列表密度</span><span className="vg-moment-setting-buttons">{(['comfortable', 'compact'] as MomentsDensity[]).map((mode) => <button type="button" key={mode} className={preferences.density === mode ? 'is-selected' : ''} onClick={() => applyPreferences({ density: mode })}>{DENSITY_LABELS[mode]}</button>)}</span></div>
          </SettingsGroup>
        </div>
      </Modal>

      <Modal open={mutedSheetOpen} onClose={() => setMutedSheetOpen(false)} onBack={() => { setMutedSheetOpen(false); setSettingsOpen(true); }} title="不看他（她）的朋友圈" mobileFullHeight panelClassName="vg-settings-panel vg-moments-panel"><div className="vg-settings-design vg-moment-settings-detail vg-moment-muted-sheet"><p>仅隐藏对方动态；对方仍可看你的动态并互动。</p>{contacts.length === 0 ? <div className="vg-moments-empty">还没有可设置的角色。</div> : <div className="vg-moment-block-list">{contacts.map((contact) => <label key={contact.id}><span><Avatar avatar={contact.avatar} size="sm" /><b>{contact.name}</b></span><input type="checkbox" checked={mutedIds.includes(contact.id)} onChange={(event) => toggleMute(contact.id, event.target.checked)} /></label>)}</div>}</div></Modal>

      <Modal presentation="dialog" width="max-w-sm" open={historySheetOpen} onClose={() => setHistorySheetOpen(false)} onBack={() => { setHistorySheetOpen(false); setSettingsOpen(true); }} title="角色可看的历史动态" panelClassName="vg-settings-panel vg-moments-panel"><div className="vg-settings-design vg-moment-settings-detail vg-moment-history-sheet"><p>范围外动态不会被角色看到或触发回忆；你仍可查看。</p><div className="vg-moment-audience"><div>{HISTORY_WINDOWS.map((window) => <button type="button" key={window} className={preferences.historyWindow === window ? 'is-selected' : ''} onClick={() => { applyPreferences({ historyWindow: window as MomentsHistoryWindow }); setHistorySheetOpen(false); setToast(`角色只能看到「${HISTORY_WINDOW_LABELS[window]}」的动态`); }}>{HISTORY_WINDOW_LABELS[window]}</button>)}</div></div></div></Modal>

      {deleteComment && <Modal presentation="dialog" open panelClassName="vg-moments-panel" title="删除这条评论？" onClose={() => setDeleteComment(null)} canSnapshotOnExit={() => useAuthStore.getState().userId === userId}><section className="vg-moment-sheet vg-moment-delete-sheet"><p>评论会从这条动态下消失；角色已经记住的内容不会因此被抹掉。</p><button type="button" className="vg-moment-publish is-danger" onClick={() => void confirmDeleteComment()}>删除评论</button></section></Modal>}

      {editingMomentId && <Modal open panelClassName="vg-moments-panel" title="修改谁可以看" onClose={() => setEditingMomentId(null)} canSnapshotOnExit={() => useAuthStore.getState().userId === userId}><section className="vg-moment-sheet vg-moment-edit-sheet"><div className="vg-moment-audience"><div>{(['all', 'selected', 'excluded', 'private'] as AudienceMode[]).map((mode) => <button type="button" key={mode} className={editAudience === mode ? 'is-selected' : ''} onClick={() => setEditAudience(mode)}>{mode === 'all' ? '全部角色' : mode === 'selected' ? '部分可见' : mode === 'excluded' ? '不给谁看' : '仅自己'}</button>)}</div>{(editAudience === 'selected' || editAudience === 'excluded') && <div className="vg-moment-contact-picker">{contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={editSelected.includes(contact.id)} onChange={(event) => setEditSelected((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} />{contact.name}</label>)}</div>}</div><button type="button" className="vg-moment-publish" onClick={() => void saveAudienceEdit()}>保存可见范围</button></section></Modal>}

      {composerOpen && <Modal open title="发布动态" panelClassName="vg-moments-compose-panel vg-moments-panel" onClose={requestCloseComposer} headerActions={<button type="button" className="vg-moment-publish vg-moment-header-publish" disabled={saving || (!text.trim() && images.length === 0)} onClick={() => void publish()}>{saving ? '保存中' : '发布'}</button>} canSnapshotOnExit={() => useAuthStore.getState().userId === userId}><section className="vg-moment-sheet vg-moment-composer"><textarea aria-label="动态内容" className="vg-text-field" autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="此刻想留下什么？" maxLength={2000} /><div className="vg-moment-preview-grid">{images.map((image, index) => <div key={`${image.dataUrl.slice(0, 20)}-${index}`}><img src={image.dataUrl} alt="待发布图片" /><button type="button" onClick={() => setImages((current) => current.filter((_, item) => item !== index)) } aria-label="移除待发布图片"><Icon name="close" size={16} /></button></div>)}{images.length < 9 && <button type="button" className="vg-moment-add-image" aria-label="添加动态图片" onClick={() => fileRef.current?.click()}><Icon name="image" size={22} /><span>图片</span></button>}</div><input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => { void pickImages(event.target.files); event.currentTarget.value = ''; }} /><div className="vg-moment-audience"><span>谁可以看</span><div>{(['all', 'selected', 'excluded', 'private'] as AudienceMode[]).map((mode) => <button type="button" key={mode} className={audience === mode ? 'is-selected' : ''} onClick={() => setAudience(mode)}>{mode === 'all' ? '全部角色' : mode === 'selected' ? '部分可见' : mode === 'excluded' ? '不给谁看' : '仅自己'}</button>)}</div>{(audience === 'selected' || audience === 'excluded') && <div className="vg-moment-contact-picker">{contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={selected.includes(contact.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} />{contact.name}</label>)}</div>}{selectedNames.length > 0 && (audience === 'selected' || audience === 'excluded') && <small>{audience === 'selected' ? '可见' : '不可见'}：{selectedNames.join('、')}</small>}</div>{publishError && <p className="vg-moment-compose-error" role="alert">{publishError}</p>}</section></Modal>}
      {discardComposer && <Modal open presentation="dialog" panelClassName="vg-moments-panel" title="放弃这次编辑？" onClose={() => setDiscardComposer(false)}><section className="vg-moment-sheet"><p>尚未发布的文字和图片会被清除。</p><div className="vg-moment-discard-actions"><button type="button" onClick={() => setDiscardComposer(false)}>继续编辑</button><button type="button" onClick={() => { setDiscardComposer(false); closeComposer(); }}>放弃草稿</button></div></section></Modal>}
    </div>
  );
}

export default MomentsPage;
