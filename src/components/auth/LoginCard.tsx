import { useState } from 'react';
import { ipc } from '../../lib/ipc-client';
import { hashPassword, decryptApiKey } from '../../lib/crypto';
import { persistApiKey, clearPersistedApiKey } from '../../lib/api-key-storage';
import { userRepo } from '../../db/user-repo';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { LegalNoticeModal, type LegalDocument } from '../compliance/LegalNoticeModal';
import { GeneGlyph } from '../ui/GeneGlyph';

interface Props {
  onSwitch: () => void;
}

export function LoginCard({ onSwitch }: Props) {
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('请填写用户名和密码');
      return;
    }
    if (!adultConfirmed) {
      setError('当前服务仅向年满 18 周岁的用户开放');
      return;
    }

    setLoading(true);
    try {
      const user = await userRepo.findByUsername(username.trim());
      if (!user) {
        setError('用户名不存在，请先注册你的基因');
        return;
      }

      const saltBytes = Uint8Array.from(atob(user.passwordSalt), (c) => c.charCodeAt(0));
      const { hash } = await hashPassword(password, saltBytes);
      if (hash !== user.passwordHash) {
        setError('密码错误，基因序列不匹配');
        return;
      }

      const key = user.apiKeyIv && user.apiKeyCiphertext
        ? await decryptApiKey(user.apiKeyIv, user.apiKeyCiphertext, password, saltBytes)
        : null;

      login(user.id, user.username, key, user.avatar ?? DEFAULT_USER_AVATAR);
      // 同一台手机「记住登录」：API Key 加密持久化，下次启动自动恢复
      if (key) void persistApiKey(key);
      else clearPersistedApiKey();
      ipc.window.setSize(1200, 800);
    } catch {
      setError('唤醒数字灵魂失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <form onSubmit={handleSubmit} className="w-full space-y-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex justify-center text-[color:var(--vg-accent)]"><GeneGlyph size={36} /></div>
        <h2 className="text-lg font-semibold text-ink">唤醒数字灵魂</h2>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Reuse the conversation search surface and its inner focus highlight. */}
      <div className="space-y-3">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="用户名"
          aria-label="用户名"
          autoComplete="username"
          className="vg-text-field w-full px-3 py-3 text-base"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          aria-label="密码"
          autoComplete="current-password"
          className="vg-text-field w-full px-3 py-3 text-base"
        />
      </div>

      <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface/60 px-3 py-2.5 cursor-pointer">
        <input type="checkbox" checked={adultConfirmed} onChange={(event) => setAdultConfirmed(event.target.checked)} className="mt-0.5 accent-[#6C5CE7]" />
        <span className="text-xs leading-relaxed text-sub">我已年满18周岁，并知悉角色回复由人工智能生成。</span>
      </label>
      <p className="text-center text-xs text-sub">
        <button type="button" onClick={() => setLegalDocument('privacy')} className="text-[color:var(--vg-cyan)] hover:underline">隐私说明</button>
        {' · '}
        <button type="button" onClick={() => setLegalDocument('terms')} className="text-[color:var(--vg-cyan)] hover:underline">使用说明</button>
      </p>

      <button
        type="submit"
        disabled={loading || !adultConfirmed}
        className="w-full min-h-11 py-2.5 rounded-lg bg-gene-purple text-white text-sm font-medium hover:bg-[#5B4BD4] transition-colors disabled:opacity-50"
      >
        {loading ? '正在唤醒...' : '登录'}
      </button>

      <p className="text-center text-xs text-sub">
        尚无基因序列？{' '}
        <button type="button" onClick={onSwitch} className="text-[color:var(--vg-cyan)] hover:underline">
          注册你的基因
        </button>
      </p>
    </form>
    <LegalNoticeModal document={legalDocument} onClose={() => setLegalDocument(null)} />
    </>
  );
}
