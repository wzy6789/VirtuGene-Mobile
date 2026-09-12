import { useState } from 'react';
import { ipc } from '../../lib/ipc-client';
import { hashPassword, decryptApiKey } from '../../lib/crypto';
import { persistApiKey } from '../../lib/api-key-storage';
import { userRepo } from '../../db/user-repo';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { LegalNoticeModal, type LegalDocument } from '../compliance/LegalNoticeModal';

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

      if (!key) {
        setError('该账号没有保存 API Key，请重新注册并填写 API Key');
        return;
      }
      login(user.id, user.username, key, user.avatar ?? DEFAULT_USER_AVATAR);
      // 同一台手机「记住登录」：API Key 加密持久化，下次启动自动恢复
      void persistApiKey(key);
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
        <div className="text-3xl">🧬</div>
        <h2 className="text-lg font-semibold text-ink">唤醒数字灵魂</h2>
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
          className="w-full px-1 py-3 bg-transparent border-b border-line-strong text-ink text-sm placeholder-gray-500 focus:outline-none focus:border-gene-purple transition-colors"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          className="w-full px-1 py-3 bg-transparent border-b border-line-strong text-ink text-sm placeholder-gray-500 focus:outline-none focus:border-gene-purple transition-colors"
        />
      </div>

      <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface/60 px-3 py-2.5 cursor-pointer">
        <input type="checkbox" checked={adultConfirmed} onChange={(event) => setAdultConfirmed(event.target.checked)} className="mt-0.5 accent-[#6C5CE7]" />
        <span className="text-[11px] leading-relaxed text-gray-400">我已年满18周岁，并知悉角色回复由人工智能生成。</span>
      </label>
      <p className="text-center text-[10px] text-gray-500">
        <button type="button" onClick={() => setLegalDocument('privacy')} className="text-life-cyan hover:underline">隐私说明</button>
        {' · '}
        <button type="button" onClick={() => setLegalDocument('terms')} className="text-life-cyan hover:underline">使用说明</button>
      </p>

      <button
        type="submit"
        disabled={loading || !adultConfirmed}
        className="w-full py-2.5 rounded-lg bg-gene-purple text-white text-sm font-medium hover:bg-[#5B4BD4] transition-colors disabled:opacity-50"
      >
        {loading ? '正在唤醒...' : '登录'}
      </button>

      <p className="text-center text-xs text-gray-500">
        尚无基因序列？{' '}
        <button type="button" onClick={onSwitch} className="text-life-cyan hover:underline">
          注册你的基因
        </button>
      </p>
    </form>
    <LegalNoticeModal document={legalDocument} onClose={() => setLegalDocument(null)} />
    </>
  );
}
