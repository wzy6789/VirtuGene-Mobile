import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { EmojiPicker } from '../ui/EmojiPicker';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { userRepo } from '../../db/user-repo';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UserProfileModal({ open, onClose }: Props) {
  const userId = useAuthStore((s) => s.userId);
  const username = useAuthStore((s) => s.username);
  const avatar = useAuthStore((s) => s.avatar);
  const setAvatar = useAuthStore((s) => s.setAvatar);

  const [preview, setPreview] = useState(avatar ?? DEFAULT_USER_AVATAR);
  const [showEmoji, setShowEmoji] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setPreview(avatar ?? DEFAULT_USER_AVATAR);
  }, [open, avatar]);

  const readImage = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    await userRepo.update(userId, { avatar: preview });
    setAvatar(preview);
    setSaving(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="我的头像">
      <div className="p-6 space-y-5">
        {/* Current preview */}
        <div className="flex items-center gap-4">
          <Avatar avatar={preview} size="lg" />
          <div>
            <p className="text-sm font-medium text-ink">{username}</p>
            <p className="text-xs text-gray-500">选择 emoji 或拖拽图片更换头像</p>
          </div>
        </div>

        {/* Image drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) readImage(f);
          }}
          onClick={() => imageInputRef.current?.click()}
          className={`p-6 rounded-xl border border-dashed text-center cursor-pointer transition-colors ${
            dragOver ? 'border-life-cyan bg-life-cyan/5' : 'border-line-strong hover:border-gene-purple/50'
          }`}
        >
          <span className="text-2xl">🖼️</span>
          <p className="text-xs text-gray-500 mt-1">拖拽图片到此处，或点击上传</p>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readImage(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* Emoji picker */}
        <button
          onClick={() => setShowEmoji(!showEmoji)}
          className="text-xs text-life-cyan hover:underline"
        >
          {showEmoji ? '收起 emoji' : '选择 emoji 头像'}
        </button>
        {showEmoji && (
          <EmojiPicker
            onSelect={(emoji) => {
              setPreview(emoji);
              setShowEmoji(false);
            }}
          />
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 rounded-lg bg-gene-purple text-white text-sm hover:bg-[#5B4BD4] disabled:opacity-50 transition-colors"
        >
          {saving ? '保存中...' : '保存头像'}
        </button>
      </div>
    </Modal>
  );
}
