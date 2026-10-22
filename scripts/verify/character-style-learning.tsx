import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatStyleImport } from '../../src/components/character/ChatStyleImport';
import { CharacterAddModal } from '../../src/components/character/CharacterAddModal';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { db } from '../../src/db';

const test: any = { calls: [], reads: [], commits: [], busy: [] };
const initial = { rules: '原来确认的表达方式', examples: ['先坐会儿。'] };
let root: Root | undefined;
useAuthStore.setState({ userId: 'style-lifecycle-owner', apiKey: 'fake-local-only-key' });
useSettingsStore.setState({ defaultModel: { provider: 'deepseek', model: 'deepseek-v4-flash' } });
useChatStore.setState({ characters: [] });
// Actual taskChat -> llmChat -> request path. The mock deliberately ignores
// abort so that stale-result guards are verified independently of the signal.
window.fetch = ((_url: unknown, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
  const call: any = { signal: init.signal, body: JSON.parse(String(init.body)), reject };
  call.resolve = (rules: string) => resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ rules, examples: ['新的示例。'] }) } }] }), { headers: { 'Content-Type': 'application/json' } }));
  test.calls.push(call);
})) as typeof fetch;
const originalRead = File.prototype.arrayBuffer;
File.prototype.arrayBuffer = function () {
  if (!this.name.startsWith('held-')) return originalRead.call(this);
  return new Promise<ArrayBuffer>((resolve, reject) => test.reads.push({ resolve: (text: string) => resolve(new TextEncoder().encode(text).buffer), reject }));
};
Object.assign(test, {
  initial,
  async reset() { root?.unmount(); root = undefined; await db.delete(); await db.open(); test.calls = []; test.reads = []; test.commits = []; test.busy = []; useAuthStore.setState({ userId: 'style-lifecycle-owner' }); },
  mount() {
    root = createRoot(document.getElementById('root')!);
    function Host() {
      const [active, setActive] = React.useState(true);
      const [value, setValue] = React.useState(initial);
      test.active = setActive;
      return <div hidden={!active}><ChatStyleImport active={active} value={value} onChange={next => { test.commits.push(next); setValue(next!); }} memories={[]} onMemoriesChange={() => {}} onBusyChange={value => test.busy.push(value)} /></div>;
    }
    root.render(<Host />);
  },
  mountModal() { root = createRoot(document.getElementById('root')!); root.render(<CharacterAddModal open onClose={() => { throw Error('Learning must not close the editor'); }} />); },
  owner(value: string) { useAuthStore.setState({ userId: value }); },
  unmount() { root?.unmount(); root = undefined; },
});
Object.assign(window, { styleLearningTest: test });
