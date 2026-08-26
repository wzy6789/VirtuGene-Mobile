import { create } from 'zustand';

export interface NotifyItem {
  id: string;
  characterId: string;
  characterName: string;
  avatar: string;
  preview: string;
  createdAt: number;
}

interface NotifyState {
  items: NotifyItem[];
  push: (item: Omit<NotifyItem, 'id' | 'createdAt'>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** 顶部同时展示的流体云上限，超出挤掉最早的 */
const MAX_ITEMS = 3;

export const useNotificationStore = create<NotifyState>((set) => ({
  items: [],
  push: (item) => {
    const entry: NotifyItem = { ...item, id: crypto.randomUUID(), createdAt: Date.now() };
    set((s) => ({ items: [...s.items, entry].slice(-MAX_ITEMS) }));
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [] }),
}));
