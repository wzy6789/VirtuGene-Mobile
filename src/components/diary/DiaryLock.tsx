import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useSettingsStore, sha256 } from '../../store/settings-store';

/** 手账隐私锁门：输入 PIN 解锁（本会话内保持解锁） */
export function DiaryLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const diaryPin = useSettingsStore((s) => s.diaryPin);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!diaryPin) { onUnlock(); return; }
    const hash = await sha256(pin.trim());
    if (hash === diaryPin) {
      setError(null);
      onUnlock();
    } else {
      setError('密码不对，再试一次');
      setPin('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 bg-app">
      <div className="w-16 h-16 rounded-2xl bg-gene-purple/15 flex items-center justify-center text-3xl shadow-[0_0_24px_rgba(108,92,231,0.35)]">
        🔒
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-ink">我的手账已上锁</p>
        <p className="text-xs text-gray-500 mt-1">输入隐私密码解锁这段基因序列</p>
      </div>
      <input
        ref={inputRef}
        type="password"
        value={pin}
        onChange={(e) => { setPin(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        placeholder="输入密码"
        maxLength={32}
        className="w-56 px-4 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink text-center outline-none focus:border-gene-purple focus:shadow-[0_0_0_3px_rgba(108,92,231,0.12)] transition-all"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        onClick={() => void submit()}
        className="px-8 py-2.5 rounded-xl bg-gene-purple hover:bg-[#5B4BD4] text-sm font-medium text-white shadow-[0_2px_12px_rgba(108,92,231,0.35)] transition-all"
      >
        解锁
      </button>
    </div>
  );
}

/** PIN 设置/修改/关闭 */
export function PinSettingsModal({ open, onClose, currentPin, onSave }: {
  open: boolean;
  onClose: () => void;
  /** 当前 PIN 摘要（null = 未设置） */
  currentPin: string | null;
  onSave: (pin: string | null) => void;
}) {
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setOldPin(''); setNewPin(''); setConfirmPin(''); setError(null); }
  }, [open]);

  const submit = async () => {
    // 已有锁：先校验旧密码
    if (currentPin) {
      if (!oldPin.trim()) { setError('请输入当前密码'); return; }
      const oldHash = await sha256(oldPin.trim());
      if (oldHash !== currentPin) { setError('当前密码不对'); return; }
    }
    // 关闭锁：清空新密码 → 传 null
    if (!newPin) { onSave(null); return; }
    if (newPin.length < 4) { setError('密码至少 4 位'); return; }
    if (newPin !== confirmPin) { setError('两次输入不一致'); return; }
    onSave(newPin);
  };

  return (
    <Modal open={open} onClose={onClose} title={currentPin ? '🔒 管理手账密码' : '🔓 给手账上锁'} width="max-w-sm" closeOnBackdrop={false}>
      <div className="p-6 space-y-3">
        <p className="text-xs text-gray-500">设置后，每次打开「我的手账」都需要输入密码。密码只存在本机（SHA-256 摘要），忘记后无法找回。</p>
        {currentPin && (
          <input
            type="password"
            value={oldPin}
            onChange={(e) => setOldPin(e.target.value)}
            placeholder="当前密码"
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple"
          />
        )}
        <input
          type="password"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value)}
          placeholder={currentPin ? '新密码（留空 = 关闭手账锁）' : '设置密码（至少 4 位）'}
          className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple"
        />
        {newPin && (
          <input
            type="password"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            placeholder="再输一次新密码"
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple"
          />
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors">取消</button>
          <button
            onClick={() => void submit()}
            className="px-4 py-2 rounded-lg text-sm bg-gene-purple hover:bg-[#5B4BD4] text-white transition-all"
          >
            {currentPin ? '保存' : '上锁'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
