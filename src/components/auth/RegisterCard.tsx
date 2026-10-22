import { useId, useRef, useState } from 'react';
import { ipc } from '../../lib/ipc-client';
import { hashPassword, encryptApiKey } from '../../lib/crypto';
import { persistApiKey } from '../../lib/api-key-storage';
import { userRepo } from '../../db/user-repo';
import type { User } from '../../db/index';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { LegalNoticeModal, type LegalDocument } from '../compliance/LegalNoticeModal';
import { GeneGlyph } from '../ui/GeneGlyph';
import { AuthFeedback } from './AuthFeedback';

interface Props {
  onSwitch: () => void;
}

export function RegisterCard({ onSwitch }: Props) {
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'checking' | 'validating' | 'creating'>('form');
  const fieldId = useId();
  const submitLock = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    setAttempt(value => value + 1);
    setError('');

    if (!username.trim() || !password || !confirmPassword) {
      setError('请填写用户名和两次密码');
      return;
    }

    if (username.trim().length < 2) {
      setError('用户名至少需要 2 个字符');
      return;
    }

    if (password.length < 6) {
      setError('密码至少需要 6 位');
      return;
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不匹配');
      return;
    }

    if (!adultConfirmed) {
      setError('当前服务仅向年满 18 周岁的用户开放');
      return;
    }

    submitLock.current = true;
    setStep('checking');
    setLoading(true);
    let phase: 'read' | 'validate' | 'create' = 'read';
    try {
      const existing = await userRepo.findByUsername(username.trim());
      if (existing) {
        setError('该用户名已被注册，请选择其他基因标识');
        return;
      }

      phase = 'validate';
      if (apiKey.trim()) setStep('validating');
      const result = apiKey.trim() ? await ipc.key.validate(apiKey.trim()) : { valid: true };
      if (!result.valid) {
        setError(result.error ?? '基因序列验证失败，请检查 API Key');
        return;
      }

      phase = 'create';
      setStep('creating');
      const { hash, salt } = await hashPassword(password);
      const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
      const key = apiKey.trim();
      const encrypted = await encryptApiKey(key, password, saltBytes);

      const user: User = {
        id: crypto.randomUUID(),
        username: username.trim(),
        passwordHash: hash,
        passwordSalt: salt,
        apiKeyIv: encrypted.iv,
        apiKeyCiphertext: encrypted.ciphertext,
        adultConfirmedAt: Date.now(),
        createdAt: Date.now(),
      };

      await userRepo.create(user);
      login(user.id, user.username, key, DEFAULT_USER_AVATAR);
      // 同一台手机「记住登录」
      void persistApiKey(key);
      ipc.window.setSize(1200, 800);
    } catch {
      setError(phase === 'read' ? '暂时无法读取账号信息，请重试' : phase === 'validate' ? '连接验证未完成，请重试' : '注册未完成，请重试');
    } finally {
      submitLock.current = false;
      setLoading(false);
      setStep('form');
    }
  };

  return (
    <>
    <form onSubmit={handleSubmit} className="w-full space-y-5" aria-busy={loading} aria-labelledby={`${fieldId}-title`}>
      <div className="space-y-3">
        <div className="flex items-center gap-3"><span className="vg-auth-brand flex h-11 w-11 items-center justify-center rounded-xl border text-[color:var(--vg-accent)]"><GeneGlyph size={28} /></span><span className="text-sm font-medium text-sub">VirtuGene</span></div>
        <h1 id={`${fieldId}-title`} className="text-2xl font-semibold leading-tight text-ink">创建账号</h1>
        <p className="text-sm leading-6 text-sub">创建账号，开始一段新的相处。</p>
      </div>

      {error && <AuthFeedback message={error} attempt={attempt} />}

      {/* Reuse the same input surface as login and conversation search. */}
      <div className="space-y-3">
        <label htmlFor={`${fieldId}-username`} className="block space-y-2"><span className="block text-sm font-medium text-ink">用户名</span><input
          id={`${fieldId}-username`} disabled={loading}
          type="text"
          value={username}
          onChange={(e) => { setUsername(e.target.value); setError(''); }}
          placeholder="至少 2 个字符"
          autoComplete="username"
          autoCapitalize="none" spellCheck={false}
          className="vg-text-field w-full px-3 py-3 text-base"
        /></label>
        <label htmlFor={`${fieldId}-password`} className="block space-y-2"><span className="block text-sm font-medium text-ink">密码</span><input
          id={`${fieldId}-password`} disabled={loading}
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          placeholder="密码（至少 6 位）"
          autoComplete="new-password"
          className="vg-text-field w-full px-3 py-3 text-base"
        /></label>
        <label htmlFor={`${fieldId}-confirm`} className="block space-y-2"><span className="block text-sm font-medium text-ink">确认密码</span><input
          id={`${fieldId}-confirm`} disabled={loading}
          type="password"
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
          placeholder="再次输入密码"
          autoComplete="new-password"
          className="vg-text-field w-full px-3 py-3 text-base"
        /></label>
        <details className="rounded-xl border border-line px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-sub">已有 DeepSeek Key？<span className="ml-2 text-xs">可选配置</span></summary><div className="space-y-2 pb-3"><label htmlFor={`${fieldId}-key`} className="block text-sm font-medium text-ink">DeepSeek API Key <span className="font-normal text-xs text-sub">· 可选</span></label><div className="vg-auth-key-control relative">
          <input id={`${fieldId}-key`} disabled={loading} data-sensitive
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setError(''); }}
            placeholder="也可以进入后再配置"
            autoComplete="off" autoCapitalize="none" spellCheck={false}
            className="vg-text-field w-full px-3 py-3 pr-16 text-base"
          />
          <button
            type="button"
            disabled={loading} aria-pressed={showKey} aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(!showKey)}
            className="absolute right-1 top-1/2 -translate-y-1/2 vg-button vg-button-ghost !px-3"
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div><p className="text-xs leading-6 text-sub">可留空。进入「设置 → AI 连接」后，还可选择 OpenAI、Claude、Gemini 等服务商。</p></div></details>
      </div>

      <label className="flex min-h-12 items-start gap-3 rounded-xl border border-line bg-surface/60 px-3 py-3 cursor-pointer"><input type="checkbox" disabled={loading} checked={adultConfirmed} onChange={(event) => { setAdultConfirmed(event.target.checked); setError(''); }} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--vg-action)]" /><span className="text-sm leading-6 text-sub">我已年满 18 周岁，并知悉角色回复由模型生成，必要的对话上下文会发送至云端模型处理。</span></label>
      <div className="vg-auth-legal-actions"><button type="button" onClick={() => setLegalDocument('privacy')} className="vg-button vg-button-ghost">隐私说明</button><button type="button" onClick={() => setLegalDocument('terms')} className="vg-button vg-button-ghost">使用说明</button></div>

      <button
        type="submit"
        disabled={loading || !adultConfirmed}
        className="vg-button vg-button-primary w-full"
      >
        {step === 'checking' && '正在检查账号…'}
        {step === 'validating' && '正在验证连接…'}
        {step === 'creating' && '正在创建账号…'}
        {step === 'form' && '注册'}
      </button>

      <div className="border-t border-line pt-3 text-center">
        <p className="text-xs leading-6 text-sub">已有账号？</p>
        <button type="button" disabled={loading} onClick={onSwitch} className="vg-button vg-button-ghost w-full">
          返回登录
        </button>
      </div>
    </form>
    <LegalNoticeModal document={legalDocument} onClose={() => setLegalDocument(null)} />
    </>
  );
}
