import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';

const ACTIVE_TIME_KEY = 'virtugene-active-use-ms';
const REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000;

/** 仅累计前台使用时间；每连续累计两小时给出一次现实提醒。 */
export function UseTimeReminder() {
  const [open, setOpen] = useState(false);
  const activeMs = useRef(Number(sessionStorage.getItem(ACTIVE_TIME_KEY) || 0));
  const lastTickAt = useRef(Date.now());

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === 'visible') {
        activeMs.current += Math.min(now - lastTickAt.current, 60_000);
        sessionStorage.setItem(ACTIVE_TIME_KEY, String(activeMs.current));
        if (activeMs.current >= REMINDER_INTERVAL_MS) {
          activeMs.current = 0;
          sessionStorage.setItem(ACTIVE_TIME_KEY, '0');
          setOpen(true);
        }
      }
      lastTickAt.current = now;
    };
    const resetTick = () => { lastTickAt.current = Date.now(); };
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', resetTick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resetTick);
    };
  }, []);

  return (
    <Modal open={open} onClose={() => setOpen(false)} width="max-w-sm" closeOnBackdrop={false}>
      <div className="p-6 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-life-cyan/30 bg-life-cyan/10 text-xl">◌</div>
        <h2 className="text-base font-semibold text-ink">回到现实，休息一会儿</h2>
        <p className="mt-3 text-xs leading-6 text-gray-400">
          你已累计使用约两小时。当前互动内容由人工智能生成，角色并非真实人物。建议放下手机、活动身体，和身边的人聊一聊。
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-6 w-full rounded-lg bg-gene-purple px-4 py-2.5 text-sm font-medium text-white active:opacity-80"
        >
          我知道了
        </button>
      </div>
    </Modal>
  );
}
