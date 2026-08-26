import { create } from 'zustand';
import { ipc } from '../lib/ipc-client';

interface UpdateState {
  status: UpdateStatus | null;
  checking: boolean;
  downloading: boolean;

  init: () => () => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: null,
  checking: false,
  downloading: false,

  init: () => {
    const off = ipc.update.onStatus((status) => {
      set({ status });
      if (status.state === 'downloading') set({ downloading: true });
      if (status.state === 'downloaded' || status.state === 'not-available' || status.state === 'error') {
        set({ downloading: false });
      }
    });
    return off;
  },

  check: async () => {
    set({ checking: true, status: { state: 'checking' } });
    const result = await ipc.update.check();
    set({ checking: false });
    if (result.error) {
      set({ status: { state: 'error', message: result.error } });
    }
  },

  download: async () => {
    set({ downloading: true });
    await ipc.update.download();
  },

  install: async () => {
    await ipc.update.install();
  },
}));
