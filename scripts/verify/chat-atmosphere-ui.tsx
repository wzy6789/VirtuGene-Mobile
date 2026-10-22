import './chat-stream-ui';
import { db } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { useThemeStore } from '../../src/store/theme-store';
import { useChatAppearanceStore, chatAppearanceKey, DEFAULT_CHAT_APPEARANCE, type ChatAppearancePreference } from '../../src/store/chat-appearance-store';
import { CHAT_ATMOSPHERE_THEMES, resolveCharacterAtmosphere, type ChatAtmosphereThemeId } from '../../src/lib/chat-atmosphere';
import { installThemePreferences } from '../../src/lib/theme';
import { installUiPreferences } from '../../src/lib/ui-preferences';

// Reuse the actual ChatWindow, persistence, streaming transport and voice setup.
// Only transport is simulated; this fixture never starts a microphone or a call.
installThemePreferences();
installUiPreferences();
if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error('Isolated atmosphere fixture cannot open the microphone'); };
const transport = (window as any).chatStreamTest;
const owner = () => useAuthStore.getState().userId ?? '';

(window as any).atmosphereTest = {
  themes: CHAT_ATMOSPHERE_THEMES,
  owner,
  defaults: DEFAULT_CHAT_APPEARANCE,
  async setup(history = 4, compact = true) {
    await transport.setup(history);
    useChatAppearanceStore.setState({ byRole: {} });
    useSettingsStore.getState().setReduceMotion(false);
    document.documentElement.removeAttribute('data-vg-background');
    useThemeStore.getState().setTheme('dark');
    const host = document.getElementById('app')!;
    host.hidden = false; host.inert = false;
    this.traits('a', [], '性格：温柔、体贴。');
    this.traits('b', ['理性', '严谨'], '性格：理性、沉静。');
    if (history && compact) {
      const rows = await db.messages.where('sessionId').equals('a').sortBy('createdAt');
      await db.messages.bulkPut(rows.map((row, index) => ({ ...row, role: index === rows.length - 1 ? 'user' as const : 'assistant' as const,
        content: index === rows.length - 1 ? '今天的风很轻，想和你慢慢聊。' : '我在听。把今天的小事慢慢说给我吧。' })));
      useChatStore.setState({ messages: await db.messages.where('sessionId').equals('a').sortBy('createdAt') });
    }
  },
  traits(id: string, tags: string[], systemPrompt: string) {
    useChatStore.setState({ characters: useChatStore.getState().characters.map(c => c.id === id ? { ...c, tags, systemPrompt } : c) });
  },
  theme(mode: 'light' | 'dark' | 'system') { useThemeStore.getState().setTheme(mode); },
  setTheme(theme: ChatAtmosphereThemeId, motion: ChatAppearancePreference['motion'] = 'gentle') {
    useChatAppearanceStore.getState().setPreference(owner(), useChatStore.getState().selectedCharacterId ?? 'a', { mode: 'manual', theme, motion });
  },
  async demo() {
    await this.setup(3);
    const original = (await db.characters.get('a'))!.systemPrompt;
    const systemPrompt = `${original}\n性格：清冷克制，内里温柔。`;
    this.traits('a', ['清冷', '温柔'], systemPrompt);
    await db.characters.update('a', { tags: ['清冷', '温柔'], systemPrompt });
  },
  set(preference: ChatAppearancePreference, characterId = 'a', userId = owner()) { useChatAppearanceStore.getState().setPreference(userId, characterId, preference); },
  reset(characterId = 'a', userId = owner()) { useChatAppearanceStore.getState().reset(userId, characterId); },
  preference(characterId = 'a', userId = owner()) { return useChatAppearanceStore.getState().byRole[chatAppearanceKey(userId, characterId)] ?? DEFAULT_CHAT_APPEARANCE; },
  records() { return useChatAppearanceStore.getState().byRole; },
  account(userId: string) { useAuthStore.setState({ userId }); },
  reduced(value: boolean) { useSettingsStore.getState().setReduceMotion(value); },
  async rehydrate(value?: unknown) {
    if (value !== undefined) localStorage.setItem('virtugene-chat-appearance', JSON.stringify({ state: value, version: 0 }));
    await useChatAppearanceStore.persist.rehydrate();
  },
  persistence() { return JSON.parse(localStorage.getItem('virtugene-chat-appearance') ?? 'null'); },
  resolve: resolveCharacterAtmosphere,
  unmount: transport.unmount,
};
(window as any).chatAtmosphereTest = (window as any).atmosphereTest;
