import { create } from 'zustand';
import { stateRepo } from '../db/state-repo';
import { useAuthStore } from './auth-store';
import type { RelationMilestone } from '../db/index';

interface CharacterStateState {
  characterId: string | null;
  affinity: number;
  mood: number;
  milestones: RelationMilestone[];
  /** 自定义等阶名（key=默认等阶名 → 自定义名） */
  tierNames: Record<string, string>;
  /** 每个角色的好感度（供侧边栏关系等级标签读取） */
  affinityByCharacter: Record<string, number>;
  /** 跨档升级时触发的里程碑 toast 数据 */
  milestone: { level: string; prevLevel: string } | null;
  load: (characterId: string) => Promise<void>;
  loadAll: () => Promise<void>;
  /** 调整好感度/心情；若目标角色正是当前展示的角色，则同步更新 store */
  bump: (characterId: string, dAffinity: number, dMood: number) => Promise<void>;
  /** 自定义当前等阶名 */
  renameTier: (defaultName: string, customName: string) => Promise<void>;
  clearMilestone: () => void;
  clear: () => void;
}

export const useCharacterStateStore = create<CharacterStateState>((set, get) => ({
  characterId: null,
  affinity: 0,
  mood: 70,
  milestones: [],
  tierNames: {},
  affinityByCharacter: {},
  milestone: null,

  load: async (characterId) => {
    const userId = useAuthStore.getState().userId ?? '';
    const state = await stateRepo.getOrCreate(characterId, userId);
    set({ characterId, affinity: state.affinity, mood: state.mood, milestones: state.milestones ?? [], tierNames: state.tierNames ?? {} });
  },

  loadAll: async () => {
    const userId = useAuthStore.getState().userId ?? '';
    const states = await stateRepo.getAllByUser(userId);
    const map: Record<string, number> = {};
    for (const st of states) map[st.characterId] = st.affinity;
    set({ affinityByCharacter: map });
  },

  bump: async (characterId, dAffinity, dMood) => {
    const userId = useAuthStore.getState().userId ?? '';
    const state = await stateRepo.adjust(characterId, userId, dAffinity, dMood);
    if (get().characterId === characterId) {
      set({ affinity: state.affinity, mood: state.mood });
    }
    set((s) => ({ affinityByCharacter: { ...s.affinityByCharacter, [characterId]: state.affinity } }));
  },

  renameTier: async (defaultName, customName) => {
    const charId = get().characterId;
    if (!charId) return;
    const userId = useAuthStore.getState().userId ?? '';
    const state = await stateRepo.renameTier(charId, userId, defaultName, customName);
    if (state) {
      set({ tierNames: state.tierNames ?? {} });
    }
  },

  clearMilestone: () => set({ milestone: null }),

  clear: () => set({ characterId: null, affinity: 0, mood: 70, milestones: [], tierNames: {}, affinityByCharacter: {}, milestone: null }),
}));
