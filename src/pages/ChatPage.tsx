import { useEffect, useRef } from 'react';
import { ChatWindow } from '../components/chat/ChatWindow';
import { EmotionPanel } from '../components/chat/EmotionPanel';
import { EmotionToggleButton } from '../components/chat/EmotionToggleButton';
import { RelationMilestoneToast } from '../components/chat/RelationMilestoneToast';
import { useChatStore } from '../store/chat-store';
import { useAuthStore } from '../store/auth-store';
import { useEmotionStore } from '../store/emotion-store';
import { useCharacterStateStore } from '../store/character-state-store';

function useProactiveTimer() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const triggerProactive = useChatStore((s) => s.triggerProactive);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);

  useEffect(() => {
    if (!isLoggedIn) return;

    // Fetch unread counts on mount
    fetchUnreadCounts();

    const schedule = () => {
      // Random interval: 2-5 minutes for subsequent messages
      const delay = 120000 + Math.random() * 180000;
      timerRef.current = setTimeout(async () => {
        await triggerProactive();
        schedule();
      }, delay);
    };

    // First trigger after 15-45 seconds
    const firstDelay = 15000 + Math.random() * 30000;
    timerRef.current = setTimeout(async () => {
      await triggerProactive();
      schedule();
    }, firstDelay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isLoggedIn]);
}

/** 自动情绪结算完成后的轻提示（短暂展示，不打扰） */
function SettleToast() {
  const notice = useEmotionStore((s) => s.settleNotice);
  const clearSettleNotice = useEmotionStore((s) => s.clearSettleNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearSettleNotice, 2500);
    return () => clearTimeout(t);
  }, [notice, clearSettleNotice]);

  if (!notice) return null;
  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[65] pointer-events-none animate-cloud-in glass-card rounded-full px-4 py-1.5 text-xs text-ink shadow-lg flex items-center gap-1.5">
      <span>🧬</span>
      <span>{notice}</span>
    </div>
  );
}

export function ChatPage() {
  useProactiveTimer();

  const isPanelOpen = useEmotionStore((s) => s.isPanelOpen);
  const togglePanel = useEmotionStore((s) => s.togglePanel);
  const currentSnapshot = useEmotionStore((s) => s.currentSnapshot);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const loadSessionSnapshots = useEmotionStore((s) => s.loadSessionSnapshots);
  const clearCurrent = useEmotionStore((s) => s.clearCurrent);
  const selectedCharacterId = useChatStore((s) => s.selectedCharacterId);
  const loadCharacterState = useCharacterStateStore((s) => s.load);

  // Load snapshots when session changes (if panel is open)
  useEffect(() => {
    clearCurrent();
    if (currentSessionId) {
      loadSessionSnapshots(currentSessionId);
    }
  }, [currentSessionId]);

  // Load character affinity/mood when selected character changes
  useEffect(() => {
    if (selectedCharacterId) {
      loadCharacterState(selectedCharacterId);
    }
  }, [selectedCharacterId, loadCharacterState]);

  const emotionToggle = (
    <EmotionToggleButton
      isOpen={isPanelOpen}
      hasData={currentSnapshot != null}
      valence={currentSnapshot?.dimensions.valence}
      onClick={togglePanel}
    />
  );

  return (
    <div className="relative h-full flex">
      <SettleToast />
      <div className="flex-1 min-w-0 flex flex-col">
        <ChatWindow emotionToggle={emotionToggle} />
      </div>
      <EmotionPanel />
      <RelationMilestoneToast />
    </div>
  );
}
