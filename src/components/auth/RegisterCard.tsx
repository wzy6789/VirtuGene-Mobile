import { useState } from 'react';
import { ipc } from '../../lib/ipc-client';
import { hashPassword, encryptApiKey } from '../../lib/crypto';
import { userRepo } from '../../db/user-repo';
import type { User } from '../../db/index';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';

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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'validating' | 'creating'>('form');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password || !confirmPassword || !apiKey.trim()) {
      setError('请填写所有字段，基因序列不能有缺失');
      return;
    }

    if (username.trim().length < 2) {
      setError('用户名至少需要 2 个字符');
      return;
    }

    if (password.length < 6) {
      setError('密码至少需要 6 位基因编码');
      return;
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不匹配');
      return;
    }

    const existing = await userRepo.findByUsername(username.trim());
    if (existing) {
      setError('该用户名已被注册，请选择其他基因标识');
      return;
    }

    setStep('validating');
    setLoading(true);
    try {
      const result = await ipc.key.validate(apiKey.trim());
      if (!result.valid) {
        setError(result.error ?? '基因序列验证失败，请检查 API Key');
        setStep('form');
        setLoading(false);
        return;
      }
    } catch {
      setError('基因链接中断，请重试');
      setStep('form');
      setLoading(false);
      return;
    }

    setStep('creating');
    try {
      const { hash, salt } = await hashPassword(password);
      const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
      const { iv, ciphertext } = await encryptApiKey(apiKey.trim(), password, saltBytes);

      const user: User = {
        id: crypto.randomUUID(),
        username: username.trim(),
        passwordHash: hash,
        passwordSalt: salt,
        apiKeyIv: iv,
        apiKeyCiphertext: ciphertext,
        createdAt: Date.now(),
      };

      await userRepo.create(user);
      login(user.id, user.username, apiKey.trim(), DEFAULT_USER_AVATAR);
      ipc.window.setSize(1200, 800);
    } catch {
      setError('注册基因失败，请重试');
      setStep('form');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="text-3xl">🌱</div>
        <h2 className="text-lg font-semibold text-ink">注册你的基因</h2>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Inputs — WeChat bottom-border style */}
      <div className="space-y-1">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="用户名"
          autoComplete="username"
          className="w-full px-1 py-3 bg-transparent border-b border-line-strong text-ink text-sm placeholder-gray-500 focus:outline-none focus:border-gene-purple transition-colors"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码（至少 6 位）"
          autoComplete="new-password"
          className="w-full px-1 py-3 bg-transparent border-b border-line-strong text-ink text-sm placeholder-gray-500 focus:outline-none focus:border-gene-purple transition-colors"
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="确认密码"
          autoComplete="new-password"
          className="w-full px-1 py-3 bg-transparent border-b border-line-strong text-ink text-sm placeholder-gray-500 focus:outline-none focus:border-gene-purple transition-colors"
        />
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="DeepSeek API Key (sk-...)"
            autoComplete="off"
            className="w-full px-1 py-3 pr-10 bg-transparent border-b border-line-strong text-ink text-sm placeholder-gray-500 focus:outline-none focus:border-life-cyan transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 hover:text-sub text-xs"
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-life-cyan text-[#0F0F1A] text-sm font-semibold hover:bg-[#00B8B3] transition-colors disabled:opacity-50"
      >
        {step === 'validating' && '正在验证基因序列...'}
        {step === 'creating' && '正在注册基因...'}
        {step === 'form' && '注册'}
      </button>

      <p className="text-center text-xs text-gray-500">
        已有基因序列？{' '}
        <button type="button" onClick={onSwitch} className="text-gene-purple hover:underline">
          唤醒数字灵魂
        </button>
      </p>
    </form>
  );
}
