import { useEffect } from 'react';
import { useNotificationStore } from '../../store/notification-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { IS_MOBILE } from '../../lib/platform';

/** 每条流体云的停留时长（ms），到期自动消失 */
const DISMISS_MS = 4500;

/**
 * 应用内「流体云」消息提醒：悬停在界面顶部（标题栏下方），
 * 毛玻璃云朵 + 紫青光边 + 光晕 + 流光扫过 + 轻柔浮动。
 * 点击跳转到对应角色的会话。
 * 触发场景：① 角色主动发消息而用户没在看 TA；② 用户切走会话后，AI 的回复才到达。
 */
export function NotificationCloud() {
  const items = useNotificationStore((s) => s.items);
  const dismiss = useNotificationStore((s) => s.dismiss);

  // 每条到期自动消失
  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((item) => setTimeout(() => dismiss(item.id), DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [items, dismiss]);

  if (items.length === 0) return null;

  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[70] w-full max-w-md px-4 flex flex-col items-center gap-2.5 pointer-events-none">
      {items.map((item, idx) => (
        <button
          key={item.id}
          onClick={() => {
            void useChatStore.getState().selectCharacter(item.characterId);
            // 手机端：点提醒切到「聊天」tab 的会话列表推入聊天（返回回到会话列表）
            if (IS_MOBILE) {
              const ui = useUIStore.getState();
              ui.setMobileTab('chat');
              ui.setChatFromList(true);
              ui.setChatFromCharacters(false);
            }
            dismiss(item.id);
          }}
          className="animate-cloud-in pointer-events-auto w-full rounded-2xl bg-gradient-to-br from-gene-purple/70 via-gene-purple/25 to-life-cyan/70 p-[1.5px] shadow-[0_8px_32px_rgba(108,92,231,0.28)] hover:shadow-[0_8px_36px_rgba(108,92,231,0.40)] transition-shadow"
        >
          <div className="relative overflow-hidden rounded-[15px] glass-card px-5 py-3.5 flex items-center gap-3.5 text-left">
            {/* 顶部高光细线 */}
            <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-life-cyan/70 to-transparent" />
            {/* 内部辉光 */}
            <div className="absolute -top-7 -right-7 w-20 h-20 rounded-full bg-gene-purple/20 blur-2xl pointer-events-none" />
            <div className="absolute -bottom-7 -left-7 w-20 h-20 rounded-full bg-life-cyan/15 blur-2xl pointer-events-none" />
            {/* 顶部流光（不盖文字，避免文字发虚） */}
            <div className="cloud-shine" style={{ animationDelay: `${1 + idx * 0.4}s` }} />

            {/* 头像光环 */}
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-gene-purple to-life-cyan opacity-50 blur-[4px]" />
              <div className="relative w-10 h-10 rounded-full bg-panel flex items-center justify-center text-2xl overflow-hidden ring-2 ring-gene-purple/30">
                {item.avatar.startsWith('data:') ? (
                  <img src={item.avatar} alt={item.characterName} className="w-full h-full object-cover" />
                ) : (
                  item.avatar
                )}
              </div>
            </div>

            {/* 文本 */}
            <div className="relative min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{item.characterName}</p>
              <p className="text-sm text-gray-500 truncate">{item.preview}</p>
            </div>

            {/* 查看 */}
            <span className="relative shrink-0 text-sm px-3 py-1 rounded-full bg-life-cyan/10 text-life-cyan border border-life-cyan/25 hover:bg-life-cyan/20 transition-colors">
              查看
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
