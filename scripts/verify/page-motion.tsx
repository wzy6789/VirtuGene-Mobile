import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useMobilePageMotion } from '../../src/components/ui/useMobilePageMotion';
import { usePageSwipe } from '../../src/components/ui/usePageSwipe';
import type { MobileTab } from '../../src/store/ui-store';

const tabs: MobileTab[] = ['chat', 'world', 'characters', 'me'];
let commits = 0;
let asynchronous = false;
function App() {
  const [position, setPosition] = useState({ key: 'chat', tab: 'chat' as MobileTab, depth: 0 });
  const pageRef = useMobilePageMotion(position);
  const swipeRef = usePageSwipe(true, position.tab, dx => !!tabs[tabs.indexOf(position.tab) + (dx < 0 ? 1 : -1)], dx => {
    commits++;
    const tab = tabs[tabs.indexOf(position.tab) + (dx < 0 ? 1 : -1)];
    if (asynchronous) setTimeout(() => setPosition({ key: tab, tab, depth: 0 }), 35);
    else setPosition({ key: tab, tab, depth: 0 });
  });
  Object.assign(window, {
    pageMotionTest: {
      navigate(tab: MobileTab, depth = 0) { flushSync(() => setPosition({ key: `${tab}-${depth}`, tab, depth })); },
      asynchronous(value: boolean) { asynchronous = value; },
      commits: () => commits,
      touch(type: string, x: number, y = 200, count = 1) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'touches', { value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })) });
        document.querySelector('[data-live-page] .surface')!.dispatchEvent(event);
      },
    },
  });
  return <div className="mobile-layout">
    <div ref={swipeRef} data-page-swipe="true" className="swipe-owner">
      <div ref={pageRef} key={position.key} data-live-page={position.tab} className="vg-page-transition">
        <div className="surface"><h1>{position.tab}</h1><p>Keep one live page, including during interrupted navigation.</p>
          <div className="scroller"><div style={{ height: 1400 }}>Scrollable history</div></div>
        </div>
      </div>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
