import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ElasticTabs } from '../../src/components/ui/ElasticTabs';
import '../../src/styles/glass-surfaces.css';

type Channel = 'all' | 'dialogue' | 'groups' | 'assistant';
const items = (['all', 'dialogue', 'groups', 'assistant'] as const).map((value, i) => ({ value, label: <span data-elastic-label>{['全部', '对话', '群聊', '助理'][i]}</span> }));
const commits: string[] = [];
let lastGrab: { before: number; after: number } | undefined;
const x = (element: Element) => { const value = getComputedStyle(element).transform; return value === 'none' ? 0 : new DOMMatrixReadOnly(value).m41; };

function Fixture() {
  const [value, setValue] = useState<Channel>('all');
  const [owner, setOwner] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.querySelector('[data-elastic-tabs]')!;
    const measureGrab = () => {
      const surface = root.querySelector('.vg-elastic-position')!;
      const before = x(surface);
      queueMicrotask(() => { lastGrab = { before, after: x(surface) }; });
    };
    root.addEventListener('pointerdown', measureGrab, true);
    return () => root.removeEventListener('pointerdown', measureGrab, true);
  }, []);
  Object.assign(window, { elasticNavigationTest: {
    snapshot: () => ({ value, commits: [...commits], phase: document.querySelector<HTMLElement>('[data-elastic-tabs]')!.dataset.elasticPhase, lastGrab }),
    changeOwner: () => { commits.length = 0; setOwner(previous => previous + 1); },
    clearCommits: () => { commits.length = 0; },
  } });
  return <main className="fixture">
    <h1>导航与频道 · 实际组件隔离预览</h1>
    <ElasticTabs items={items} value={value} onChange={next => { commits.push(next); setValue(next); }} ariaLabel="聊天频道"
      gestureKey={String(owner)} contentRef={contentRef} />
    <div ref={contentRef} className="fixture-content"><h2>{items.find(item => item.value === value)?.label}</h2>
      <p>文字、图标与点击区域保持尺寸；拖动只改变材质底板和内容面的平移。</p>
      <p>此预览不加载数据库、聊天模型、麦克风或实际通话。</p>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
