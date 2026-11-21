import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { IS_MOBILE } from '../../lib/platform';
import { lazyFeature } from '../ui/lazyFeature';
import { findSecretary, SECRETARY_INTRO_PREFIX } from '../../lib/secretary/character';
import { Icon, type IconName } from '../ui/Icon';
import '../../styles/auth-ui.css';

const OnboardingModal = lazyFeature(() => import('./OnboardingModal').then(m => ({default: m.OnboardingModal})));
const SecretarySetupModal = lazyFeature(() => import('./SecretarySetupModal').then(m => ({default: m.SecretarySetupModal})));

const ONBOARDED_PREFIX = 'virtugene:onboarded:';

interface GuideTipProps {
  /** 目标元素 id：气泡通过 getBoundingClientRect 实测锚定。 */
  targetId: string;
  /** 气泡位于目标右侧或下方。 */
  placement: 'right' | 'below';
  icon: IconName;
  step: string;
  title: string;
  desc: string;
  onClose: () => void;
}

function GuideTip({ targetId, placement, icon, step, title, desc, onClose }: GuideTipProps) {
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);

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
      setRect({ left, top: r.bottom + 14 });
    }
  }, [targetId, placement]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  if (!rect) return null;

  const toRight = placement === 'right';
  return (
    /* 外层只管定位（transform 固定），动画放内层，避免动画 transform 覆盖定位导致跳动 */
    <div
      className="fixed vg-layer-onboarding"
      style={{ left: rect.left, top: rect.top, transform: toRight ? 'translateY(-50%)' : 'translateX(-50%)' }}
    >
      <div className="animate-fade-in">
      <div className="vg-onboarding-tip">
        <div className="vg-onboarding-tip-body">
          <div className="vg-onboarding-tip-heading">
            <div className="vg-onboarding-tip-icon"><Icon name={icon} size={22} /></div>
            <div className="vg-onboarding-tip-copy">
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          </div>

          <div className="vg-onboarding-tip-footer">
            <span>第 {step} 步</span>
            <button
              onClick={onClose}
              className="vg-button vg-button-primary"
            >
              知道了
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
export function OnboardingGuide({ blocked = false }: { blocked?: boolean }) {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const onboardedKey = ONBOARDED_PREFIX + userId;
  const [showWelcome, setShowWelcome] = useState(() => userId !== '' && localStorage.getItem(onboardedKey) == null);
  const [tipStep, setTipStep] = useState<0 | 1 | 2 | 3>(0);
  const [showSecretary, setShowSecretary] = useState(false);

  useEffect(() => {
    if (!userId || showWelcome) return;
    let alive = true;
    if (localStorage.getItem(SECRETARY_INTRO_PREFIX + userId) == null) {
      void findSecretary(userId).then(character => {
        if (!alive) return;
        if (!character) setShowSecretary(true);
        else localStorage.setItem(SECRETARY_INTRO_PREFIX + userId, '1');
      }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [userId, showWelcome]);

  useEffect(() => {
    const open = () => { setTipStep(0); setShowSecretary(true); };
    window.addEventListener('virtugene:open-secretary', open);
    return () => window.removeEventListener('virtugene:open-secretary', open);
  }, []);

  useEffect(() => {
    const reopen = () => {
      setShowWelcome(true);
      setTipStep(0);
    };
    window.addEventListener('virtugene:open-onboarding', reopen);
    return () => window.removeEventListener('virtugene:open-onboarding', reopen);
  }, []);

  const closeWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem(onboardedKey, '1');
    setTipStep(IS_MOBILE ? 0 : 1);
  };

  return (
    <>
      {showWelcome && !blocked && <OnboardingModal open onClose={closeWelcome} />}
      {showSecretary && !showWelcome && !blocked && <SecretarySetupModal open onClose={() => setShowSecretary(false)} />}

      {/* 1/3 基因实验室：气泡在按钮右侧，箭头朝左指向按钮 */}
      {tipStep === 1 && (
        <GuideTip
          targetId="guide-genelab"
          placement="right"
          icon="profile"
          step="1 / 3"
          title="基因实验室"
          desc="选择现成角色，或创建自己的角色。"
          onClose={() => setTipStep(2)}
        />
      )}

      {/* 2/3 情绪图谱：气泡在开关下方，箭头朝上指向开关 */}
      {tipStep === 2 && (
        <GuideTip
          targetId="guide-emotion"
          placement="below"
          icon="heart"
          step="2 / 3"
          title="查看 Ta 的情绪与关系"
          desc="查看角色心情与关系变化。"
          onClose={() => setTipStep(3)}
        />
      )}

      {/* 3/3 我的手账：气泡在 📓 按钮右侧，箭头朝左指向按钮 */}
      {tipStep === 3 && (
        <GuideTip
          targetId="guide-diary"
          placement="right"
          icon="diary"
          step="3 / 3"
          title="我的手账"
          desc="用聊天写日记，也能按日期查找和导出。"
          onClose={() => setTipStep(0)}
        />
      )}
    </>
  );
}
