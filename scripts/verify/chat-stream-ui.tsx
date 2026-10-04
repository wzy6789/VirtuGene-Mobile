import './chat-stream';
import { breathe } from '../../src/lib/haptics';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { Profiler, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useLatestMessageScroll } from '../../src/components/ui/useLatestMessageScroll';

function ScrollMotionProbe() {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useLatestMessageScroll(ref, 'motion-probe');
  useEffect(() => {
    latest(true);
    (window as any).chatStreamUi.scroll = {
      element: ref.current,
      latest: () => latest(true),
      smooth: () => latest(true, 'smooth'),
      grow: (height: number) => { ref.current!.firstElementChild!.setAttribute('style', `height:${height}px`); },
    };
  }, [latest]);
  return <div ref={ref} tabIndex={0} style={{ height: 160, overflow: 'auto', overflowAnchor: 'none' }}><div data-streaming-reply style={{ height: 1000 }} /></div>;
}

// Exercise the real bubble's audio handoff without invoking paid speech services.
(window as any).chatStreamUi = {
  commits: 0,
  breathe,
  font: (size: number) => useSettingsStore.setState({ chatFontSize: size }),
  edit: (id: string, content: string) => useChatStore.getState().updateMessage(id, { content }),
  mountScrollProbe: () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:320px;z-index:9999';
    document.body.append(host);
    const root = createRoot(host);
    root.render(<Profiler id="scroll-probe" onRender={() => { (window as any).chatStreamUi.commits++; }}><ScrollMotionProbe /></Profiler>);
    (window as any).chatStreamUi.disposeScrollProbe = () => { root.unmount(); host.remove(); };
  },
  audio: (id: string, ready: boolean) => useChatStore.getState().updateMessage(id, {
    showAudioTranscript: true,
    audio: { dataUrl: ready ? 'data:audio/wav;base64,UklGRg==' : '', duration: ready ? 6 : 0, text: useChatStore.getState().messages.find(m => m.id === id)!.content },
  }),
};
