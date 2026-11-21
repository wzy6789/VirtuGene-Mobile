import Dexie, { type Table } from 'dexie';
import { useAuthStore } from '../store/auth-store';
import { normalizeChatBackground, DEFAULT_GLOBAL_BACKGROUND, adoptCinematicChatBackground, CINEMATIC_CHAT_DEFAULT_VERSION, type ChatBackgroundConfig, type GlobalChatBackground } from '../lib/chat-background-config';

export interface BackgroundSetting { id: string; userId: string; roleId: string; revision: number; config: ChatBackgroundConfig; strategy?: GlobalChatBackground['strategy']; /** Explicit editor save; distinct from an automatically initialized default. */ choice?:'user'; cinematicDefaultVersion?:number }
export interface BackgroundAsset { id: string; userId: string; source: Blob; display: Blob; width: number; height: number; blur: number; createdAt: number }
/** Separate local-only database: excluded from chat backups, synchronization and model inputs. */
class BackgroundDatabase extends Dexie {
  settings!: Table<BackgroundSetting, string>;
  assets!: Table<BackgroundAsset, string>;
  constructor() { super('virtugene-chat-background-local'); this.version(1).stores({ settings: 'id,userId,[userId+roleId]', assets: 'id,userId' }); }
}
export const backgroundDb = new BackgroundDatabase();
export const backgroundSettingKey = (userId: string, roleId: string) => JSON.stringify([userId, roleId]);
const owned = (userId: string) => { if (!userId || useAuthStore.getState().userId !== userId) throw Error('background:owner'); };
async function collect(userId: string) {
  const configs = await backgroundDb.settings.where('userId').equals(userId).toArray();
  // A future schema may reference assets through fields this version cannot interpret.
  if(configs.some(row=>row.config?.schemaVersion!==1))return;
  const references = new Set(configs.filter(row => row.config?.mode === 'image').map(row => row.config.imageAssetId));
  const assets = await backgroundDb.assets.where('userId').equals(userId).primaryKeys();
  await backgroundDb.assets.bulkDelete(assets.filter(id => !references.has(id)));
}
export const chatBackgroundRepo = {
  async load(userId: string) {
    owned(userId);
    // Migrate existing small local visual preferences once per account. No chat database is read.
    await backgroundDb.transaction('rw', backgroundDb.settings, backgroundDb.assets, async () => {
      const globalKey = backgroundSettingKey(userId, '');
      const globalRow=await backgroundDb.settings.get(globalKey);
      if (!globalRow) {
        let legacy: Record<string, {mode?:string;theme?:string;motion?:string}> = {};
        try { legacy = JSON.parse(localStorage.getItem('virtugene-chat-appearance') ?? '{}').state?.byRole ?? {}; } catch { /* No usable legacy visual settings. */ }
        for (const [key, preference] of Object.entries(legacy)) {
          let pair: unknown; try { pair = JSON.parse(key); } catch { continue; }
          if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== userId || typeof pair[1] !== 'string' || !pair[1] || !['manual','character'].includes(preference?.mode ?? '')) continue;
          if (preference.mode === 'character' && (!preference.motion || preference.motion==='gentle')) continue;
          const config = normalizeChatBackground({ ...DEFAULT_GLOBAL_BACKGROUND.config, themeId: preference.theme, strength: preference.motion }).config;
          const id = backgroundSettingKey(userId, pair[1]);
          if (!await backgroundDb.settings.get(id)) await backgroundDb.settings.put({ id, userId, roleId: pair[1], revision: 1, config });
        }
        await backgroundDb.settings.put({ id: globalKey, userId, roleId:'', revision:1, ...DEFAULT_GLOBAL_BACKGROUND, cinematicDefaultVersion:CINEMATIC_CHAT_DEFAULT_VERSION });
      }
      if(!globalRow||globalRow.config?.schemaVersion===1&&(globalRow.cinematicDefaultVersion??0)<CINEMATIC_CHAT_DEFAULT_VERSION) {
        // One account-indexed batch, only once. Old role color/orb saves used to
        // freeze the entire flat background. Preserve their other visual fields.
        const rows=await backgroundDb.settings.where('userId').equals(userId).toArray();
        const updates:BackgroundSetting[]=[];
        for(const row of rows){
          const config=adoptCinematicChatBackground(row.config);
          if(row.roleId===''&&globalRow||config!==row.config)updates.push({...row,config,revision:row.revision+1,...(row.roleId===''?{cinematicDefaultVersion:CINEMATIC_CHAT_DEFAULT_VERSION}:{})});
        }
        owned(userId);await backgroundDb.settings.bulkPut(updates);
      }
      await collect(userId); owned(userId);
    });
    let rows = await backgroundDb.settings.where('userId').equals(userId).toArray();
    const roleRows=rows.filter(row=>row.roleId);
    if(roleRows.length){
      // One indexed batch for the known visual records, never a scan of chats,
      // memories, or every account. This also retries deferred deletion cleanup.
      const {db}=await import('./index');
      const roles=await db.characters.bulkGet(roleRows.map(row=>row.roleId));owned(userId);
      const orphanIds=roleRows.filter((row,index)=>!roles[index]||!roles[index]!.isPreset&&roles[index]!.createdBy!==userId).map(row=>row.id);
      if(orphanIds.length){await backgroundDb.transaction('rw',backgroundDb.settings,backgroundDb.assets,async()=>{owned(userId);await backgroundDb.settings.bulkDelete(orphanIds);await collect(userId);owned(userId);});rows=rows.filter(row=>!orphanIds.includes(row.id));}
    }
    owned(userId); return rows;
  },
  async removeDeletedRole(userId:string,roleId:string){
    owned(userId);if(!roleId)throw Error('background:owner');
    const {db}=await import('./index');
    if(await db.characters.get(roleId))return false;
    await backgroundDb.transaction('rw',backgroundDb.settings,backgroundDb.assets,async()=>{owned(userId);await backgroundDb.settings.delete(backgroundSettingKey(userId,roleId));await collect(userId);owned(userId);});
    return true;
  },
  async asset(userId: string, id: string) { owned(userId); const asset = await backgroundDb.assets.get(id); owned(userId); return asset?.userId === userId ? asset : undefined; },
  async save(userId: string, roleId: string, raw: ChatBackgroundConfig, expectedRevision: number, strategy: GlobalChatBackground['strategy'], prepared?: Omit<BackgroundAsset, 'userId'|'createdAt'>) {
    owned(userId); const id = backgroundSettingKey(userId, roleId), config = normalizeChatBackground(raw).config;
    // A single avatar must never become every character's global default.
    if (!roleId) delete config.roleVisual;
    if (raw.schemaVersion !== 1 || !['fixed','characterRecommended'].includes(strategy)) throw Error('background:schema');
    const row: BackgroundSetting = { id, userId, roleId, revision: expectedRevision + 1, config, choice:'user', ...(!roleId ? { strategy,cinematicDefaultVersion:CINEMATIC_CHAT_DEFAULT_VERSION } : {}) };
    await backgroundDb.transaction('rw', backgroundDb.settings, backgroundDb.assets, async () => {
      owned(userId);
      const previous=await backgroundDb.settings.get(id);
      if (previous?.revision !== (expectedRevision || undefined)) throw Error('background:conflict');
      if(previous&&previous.config?.schemaVersion!==1)throw Error('background:schema');
      if (config.mode === 'image') {
        if (!config.imageAssetId) throw Error('background:missing');
        if (prepared && prepared.id === config.imageAssetId) await backgroundDb.assets.put({ ...prepared, userId, createdAt: Date.now() });
        const asset = await backgroundDb.assets.get(config.imageAssetId);
        if (!asset || asset.userId !== userId || asset.blur !== config.blur) throw Error('background:missing');
      }
      await backgroundDb.settings.put(row); await collect(userId); owned(userId);
    });
    return row;
  },
  async resetRole(userId: string, roleId: string, expectedRevision: number) {
    owned(userId); if (!roleId) throw Error('background:owner');
    await backgroundDb.transaction('rw', backgroundDb.settings, backgroundDb.assets, async () => {
      const id = backgroundSettingKey(userId, roleId);
      const previous=await backgroundDb.settings.get(id);
      if (previous?.revision !== (expectedRevision || undefined)) throw Error('background:conflict');
      if(previous&&previous.config?.schemaVersion!==1)throw Error('background:schema');
      await backgroundDb.settings.delete(id); await collect(userId); owned(userId);
    });
  },
};
