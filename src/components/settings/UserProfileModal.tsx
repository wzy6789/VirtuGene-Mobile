import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { EmojiPicker } from '../ui/EmojiPicker';
import { Icon } from '../ui/Icon';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { userRepo } from '../../db/user-repo';

interface Props { open: boolean; onClose: () => void }
export function UserProfileModal(props: Props) {
  const owner = useAuthStore(s => s.userId);
  return <ProfileEditor key={owner ?? 'guest'} {...props} />;
}
function ProfileEditor({ open, onClose }: Props) {
  const { userId, username, avatar, setAvatar } = useAuthStore();
  const [preview, setPreview] = useState(avatar ?? DEFAULT_USER_AVATAR);
  const [showEmoji, setShowEmoji] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageEpoch = useRef(0);
  const lock = useRef(false);
  const visible = useRef(open);
  visible.current = open;
  useEffect(() => {
    visible.current = open;
    setPreview(useAuthStore.getState().avatar ?? DEFAULT_USER_AVATAR);
    setShowEmoji(false); setError(''); setProcessing(false); setSaving(false); imageEpoch.current++;
    return () => { visible.current = false; imageEpoch.current++; };
  }, [open]);
  const current = () => visible.current && useAuthStore.getState().userId === userId;
  const close = () => { if (!lock.current) onClose(); };

  const readImage = (file: File) => {
    if (lock.current) return;
    if (!file.type.startsWith('image/')) { setError('请选择图片文件。'); return; }
    const epoch = ++imageEpoch.current;
    const valid = () => current() && epoch === imageEpoch.current;
    setProcessing(true); setError('');
    const fail = () => { if (valid()) { setProcessing(false); setError('这张图片暂时无法读取，请换一张再试。'); } };
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      if (!valid()) return;
      const img = new Image();
      img.onerror = fail;
      img.onload = () => {
        if (!valid()) return;
        try {
          const size = 256;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx || !img.width || !img.height) { fail(); return; }
          const side = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          ctx.globalCompositeOperation = 'destination-in'; ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
          setPreview(canvas.toDataURL('image/png')); setProcessing(false);
        } catch { fail(); }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  const save = async () => {
    if (!userId || lock.current || processing || !current()) return;
    lock.current = true; setSaving(true); setError('');
    try {
      await userRepo.update(userId, { avatar: preview });
      if (!current()) return;
      setAvatar(preview); onClose();
    } catch {
      if (current()) setError('头像没有保存成功，已保留你的选择，请重试。');
    } finally {
      lock.current = false;
      if (current()) setSaving(false);
    }
  };
  return <>
    <Modal presentation="dialog" panelClassName="vg-settings-panel" open={open} onClose={close} title="我的头像" width="max-w-sm" canSnapshotOnExit={() => false} footer={<div className="vg-settings-design !py-3"><button type="button" onClick={() => void save()} disabled={saving || processing} className="vg-button vg-button-primary w-full">{saving ? '保存中…' : processing ? '正在读取图片…' : '保存头像'}</button></div>}>
      <div className="vg-settings-design space-y-5" aria-busy={saving || processing}>
        <div className="flex items-center gap-4"><Avatar avatar={preview} size="lg" /><div className="min-w-0"><p className="text-base font-medium text-ink break-words">{username}</p><p className="text-xs leading-6 text-sub">挑选一张照片，或使用表情头像。</p></div></div>
        <button type="button" disabled={saving || processing} onDragOver={event => { event.preventDefault(); if (!saving) setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={event => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files?.[0]; if (file) readImage(file); }} onClick={() => imageInputRef.current?.click()} className={`w-full p-5 rounded-2xl border border-dashed text-center ${dragOver ? 'border-life-cyan bg-life-cyan/5' : 'border-line-strong bg-surface'}`}>
          <Icon name="image" size={28} className="mx-auto mb-2 text-sub" /><span className="block text-sm text-ink">选择照片</span><span className="vg-avatar-drop-hint block mt-1 text-xs leading-6 text-sub">也可以把图片拖到这里</span>
        </button>
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" aria-label="上传头像图片" onChange={event => { const file = event.target.files?.[0]; if (file) readImage(file); event.target.value = ''; }} />
        <button type="button" disabled={saving || processing} onClick={() => setShowEmoji(true)} className="vg-button vg-button-secondary w-full">表情头像</button>
        {error && <FeedbackNotice message={error} tone="error" />}
      </div>
    </Modal>
    <Modal presentation="dialog" open={showEmoji && open} onClose={() => setShowEmoji(false)} title="选择表情头像" width="max-w-sm" canSnapshotOnExit={() => false}><div className="p-4"><EmojiPicker onSelect={emoji => { setPreview(emoji); setError(''); setShowEmoji(false); }} /></div></Modal>
  </>;
}
