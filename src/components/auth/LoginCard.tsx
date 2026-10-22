import { useId, useRef, useState } from 'react';
import { ipc } from '../../lib/ipc-client';
import { hashPassword, decryptApiKey } from '../../lib/crypto';
import { persistApiKey, clearPersistedApiKey } from '../../lib/api-key-storage';
import { userRepo } from '../../db/user-repo';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { LegalNoticeModal, type LegalDocument } from '../compliance/LegalNoticeModal';
import { GeneGlyph } from '../ui/GeneGlyph';
import { AuthFeedback } from './AuthFeedback';

interface Props {
  onSwitch: () => void;
}

export function LoginCard({ onSwitch }: Props) {
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null);
  const fieldId = useId();
  const submitLock = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    setAttempt(value => value + 1);
    setError('');

    if (!username.trim() || !password) {
      setError('请填写用户名和密码');
      return;
    }
    if (!adultConfirmed) {
      setError('当前服务仅向年满 18 周岁的用户开放');
      return;
    }

    submitLock.current = true;
    setLoading(true);
    try {
      const user = await userRepo.findByUsername(username.trim());
      if (!user) {
        setError('用户名不存在，请先注册账号');
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
      setError('登录失败，请重试');
    } finally {
      submitLock.current = false;
      setLoading(false);
    }
  };

  return (
    <>
    <form onSubmit={handleSubmit} className="w-full space-y-5" aria-busy={loading} aria-labelledby={`${fieldId}-title`}>
      <div className="space-y-3">
        <div className="flex items-center gap-3"><span className="vg-auth-brand flex h-11 w-11 items-center justify-center rounded-xl border text-[color:var(--vg-accent)]"><GeneGlyph size={28} /></span><span className="text-sm font-medium text-sub">VirtuGene</span></div>
        <h1 id={`${fieldId}-title`} className="text-2xl font-semibold leading-tight text-ink">欢迎回来</h1>
        <p className="text-sm leading-6 text-sub">登录，继续你们的故事。</p>
      </div>

      {error && <AuthFeedback message={error} attempt={attempt} />}

      {/* Reuse the conversation search surface and its inner focus highlight. */}
      <div className="space-y-3">
        <label htmlFor={`${fieldId}-username`} className="block space-y-2"><span className="block text-sm font-medium text-ink">用户名</span><input
          id={`${fieldId}-username`} disabled={loading}
          type="text"
          value={username}
          onChange={(e) => { setUsername(e.target.value); setError(''); }}
          placeholder="输入你的用户名"
          autoComplete="username"
          autoCapitalize="none" spellCheck={false}
          className="vg-text-field w-full px-3 py-3 text-base"
        /></label>
        <label htmlFor={`${fieldId}-password`} className="block space-y-2"><span className="block text-sm font-medium text-ink">密码</span><input
          id={`${fieldId}-password`} disabled={loading}
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          placeholder="输入登录密码"
          autoComplete="current-password"
          className="vg-text-field w-full px-3 py-3 text-base"
        /></label>
      </div>

      <label className="flex min-h-12 items-start gap-3 rounded-xl border border-line bg-surface/60 px-3 py-3 cursor-pointer">
        <input type="checkbox" disabled={loading} checked={adultConfirmed} onChange={(event) => { setAdultConfirmed(event.target.checked); setError(''); }} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--vg-action)]" />
        <span className="text-sm leading-6 text-sub">我已年满18周岁，并知悉角色回复由人工智能生成。</span>
      </label>
      <div className="vg-auth-legal-actions"><button type="button" onClick={() => setLegalDocument('privacy')} className="vg-button vg-button-ghost">隐私说明</button><button type="button" onClick={() => setLegalDocument('terms')} className="vg-button vg-button-ghost">使用说明</button></div>

      <button
        type="submit"
        disabled={loading || !adultConfirmed}
        className="vg-button vg-button-primary w-full"
      >
        {loading ? '正在登录…' : '登录'}
      </button>

      <div className="border-t border-line pt-3 text-center">
        <p className="text-xs leading-6 text-sub">还没有账号？</p>
        <button type="button" disabled={loading} onClick={onSwitch} className="vg-button vg-button-ghost w-full">
          注册账号
        </button>
      </div>
    </form>
    <LegalNoticeModal document={legalDocument} onClose={() => setLegalDocument(null)} />
    </>
  );
}
