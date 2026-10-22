import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AttachmentSheet } from '../../src/components/chat/AttachmentSheet';
import '../../src/styles/glass-surfaces.css';

let closes = 0, images = 0, clickTurn = false, imageInsideClick = false;
let lastGrab: { before: number; after: number } | undefined;
const readY = (element: Element) => { const transform = getComputedStyle(element).transform; return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42; };
function Fixture() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest('.vg-attachment-drag-region')) return;
      const panel = target.closest('.vg-modal-panel')!;
      const before = readY(panel);
      queueMicrotask(() => { lastGrab = { before, after: readY(panel) }; });
    };
    const click = () => { clickTurn = true; queueMicrotask(() => { clickTurn = false; }); };
    document.addEventListener('pointerdown', down, true); document.addEventListener('click', click, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('click', click, true); };
  }, []);
  Object.assign(window, { attachmentSheetTest: {
    snapshot: () => ({ open, closes, images, imageInsideClick, lastGrab }),
    unmount: () => setOpen(false),
    open: () => setOpen(true),
  } });
  return <main className="fixture"><h1>附件 Sheet · 实际组件隔离预览</h1>
    <p>此页使用真实 AttachmentSheet 与 Modal，图片动作只计数，不打开文件、数据库、模型或麦克风。</p>
    <button type="button" onClick={() => setOpen(true)}>添加附件</button>
    <AttachmentSheet open={open} onClose={() => { closes++; setOpen(false); }} onImage={() => { images++; imageInsideClick = clickTurn; }} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
