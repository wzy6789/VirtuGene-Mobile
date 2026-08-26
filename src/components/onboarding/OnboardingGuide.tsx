import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { OnboardingModal } from './OnboardingModal';

const ONBOARDED_PREFIX = 'virtugene:onboarded:';

interface GuideTipProps {
  /** 目标元素 id：气泡通过 getBoundingClientRect 实测锚定，箭头绝对对准 */
  targetId: string;
  /** right = 气泡在目标右侧，箭头朝左；below = 气泡在目标下方，箭头朝上 */
  placement: 'right' | 'below';
  icon: string;
  step: string;
  title: string;
  desc: string;
  onClose: () => void;
}

function GuideTip({ targetId, placement, icon, step, title, desc, onClose }: GuideTipProps) {
  const [rect, setRect] = useState<{ left: number; top: number; arrowX?: number } | null>(null);

  const measure = useCallback(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const TIP_W = 320;
    const MARGIN = 12;
    if (placement === 'right') {
      // 气泡在目标右侧；钳制不让它溢出视口
      const left = Math.min(r.right + 14, window.innerWidth - TIP_W - MARGIN);
      setRect({ left, top: r.top + r.height / 2 });
    } else {
      // 气泡在目标下方、水平居中；靠近边缘时钳制，保证完整可见
      const center = r.left + r.width / 2;
      const left = Math.max(TIP_W / 2 + MARGIN, Math.min(center, window.innerWidth - TIP_W / 2 - MARGIN));
      // 箭头在框内移动到对准目标中心（框整体不动）
      const arrowX = Math.max(24, Math.min(TIP_W - 24, center - (left - TIP_W / 2)));
      setRect({ left, top: r.bottom + 14, arrowX });
    }
  }, [targetId, placement]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  if (!rect) return null;

  const arrowLeft = placement === 'right';
  return (
    /* 外层只管定位（transform 固定），动画放内层，避免动画 transform 覆盖定位导致跳动 */
    <div
      className="fixed z-[55]"
      style={{ left: rect.left, top: rect.top, transform: arrowLeft ? 'translateY(-50%)' : 'translateX(-50%)' }}
    >
      <div className="animate-fade-in">
      {/* 渐变光边 + 光晕 */}
      <div className="relative w-80 rounded-2xl bg-gradient-to-br from-gene-purple/70 via-gene-purple/25 to-life-cyan/60 p-[1.5px] shadow-[0_12px_40px_rgba(108,92,231,0.28)]">
        {/* 箭头（外层，不被裁剪；尖角指向目标中心） */}
        {arrowLeft ? (
          <span className="absolute top-1/2 -left-[10px] -translate-y-1/2 w-4 h-4 rotate-45 bg-gradient-to-br from-gene-purple to-life-cyan" />
        ) : (
          <span
            className="absolute -top-[10px] w-4 h-4 bg-gradient-to-br from-gene-purple to-life-cyan"
            style={{ left: rect.arrowX ?? 160, transform: 'translateX(-50%) rotate(45deg)' }}
          />
        )}

        <div className="relative overflow-hidden rounded-[14px] bg-panel/95 backdrop-blur-xl p-4">
          {/* 内部辉光 */}
          <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-gene-purple/15 blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-28 h-28 rounded-full bg-life-cyan/10 blur-2xl pointer-events-none" />

          <div className="relative flex items-start gap-3">
            {/* 图标光晕 */}
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-xl bg-gene-purple/30 blur-[4px]" />
              <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-[#2A2A48] to-[#0A0A14] flex items-center justify-center text-xl ring-1 ring-gene-purple/30">
                {icon}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-ink">{title}</p>
              <p className="text-xs text-gray-500 leading-relaxed mt-1.5">{desc}</p>
            </div>
          </div>

          <div className="relative flex items-center justify-between mt-3 pt-2.5 border-t border-line/60">
            <span className="text-[11px] text-gray-500">第 {step} 步</span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-full text-xs font-medium text-white bg-gradient-to-r from-gene-purple to-life-cyan hover:opacity-90 transition-opacity"
            >
              知道了 →
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

/**
 * 新手引导：欢迎弹窗 → 基因实验室 → 情绪图谱 → 我的手账（日记）。
 * 气泡位置由目标元素 id 实测锚定，箭头尖角指向目标中心。
 */
export function OnboardingGuide() {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const onboardedKey = ONBOARDED_PREFIX + userId;
  const [showWelcome, setShowWelcome] = useState(() => userId !== '' && localStorage.getItem(onboardedKey) == null);
  const [tipStep, setTipStep] = useState<0 | 1 | 2 | 3>(0);

  const closeWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem(onboardedKey, '1');
    setTipStep(1);
  };

  return (
    <>
      <OnboardingModal open={showWelcome} onClose={closeWelcome} />

      {/* 1/3 基因实验室：气泡在按钮右侧，箭头朝左指向按钮 */}
      {tipStep === 1 && (
        <GuideTip
          targetId="guide-genelab"
          placement="right"
          icon="🧬"
          step="1 / 3"
          title="基因实验室"
          desc="点「基因实验室」，从「基因库」挑选现成角色，或「创造基因」培育属于你的独特灵魂。"
          onClose={() => setTipStep(2)}
        />
      )}

      {/* 2/3 情绪图谱：气泡在开关下方，箭头朝上指向开关 */}
      {tipStep === 2 && (
        <GuideTip
          targetId="guide-emotion"
          placement="below"
          icon="💞"
          step="2 / 3"
          title="查看 Ta 的情绪与关系"
          desc="点聊天窗口右上角的这颗心，看 Ta 的情绪图谱、心情曲线，以及你们的好感度关系进展。"
          onClose={() => setTipStep(3)}
        />
      )}

      {/* 3/3 我的手账：气泡在 📓 按钮右侧，箭头朝左指向按钮 */}
      {tipStep === 3 && (
        <GuideTip
          targetId="guide-diary"
          placement="right"
          icon="📓"
          step="3 / 3"
          title="我的手账"
          desc="点左栏的「📓」，用聊天的方式写日记——AI 帮你整理成正式日记，还有日历、标签、导出。"
          onClose={() => setTipStep(0)}
        />
      )}
    </>
  );
}
