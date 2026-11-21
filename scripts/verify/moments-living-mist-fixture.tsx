/** Actual Moments UI; synthetic account, blocked models/audio/native APIs in preview host. */
import { createRoot } from 'react-dom/client';
import { MomentsPage } from '../../src/components/moments/MomentsPage';
import { db } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { momentsRepo } from '../../src/db/moments-repo';
import { DEFAULT_MOMENTS_PREFERENCES, saveMomentsPreferences } from '../../src/lib/moments/preferences';
import { fakeCharacter } from './world-harness';

const owner = 'moments-mist-synthetic-20261025';
const counts = { jobsBlocked: 0 };
momentsRepo.processJobs = async () => { counts.jobsBlocked++; };
const root = createRoot(document.getElementById('app')!);
const render = () => root.render(<MomentsPage />);
const art = (color: string, label: string, w = 600, h = 600) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#142938"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * .7}" cy="${h * .3}" r="${w * .16}" fill="#dbc9a5" opacity=".6"/><path d="M0 ${h}L${w * .45} ${h * .45}L${w} ${h}Z" fill="#243f45"/><text x="24" y="${h - 30}" fill="#e4edf5" font-size="32">${label}</text></svg>`);

async function boot() {
  useAuthStore.setState({ userId: owner, username: '小满', avatar: art('#658f94', '满'), apiKey: null, gatewayAccessToken: null, gatewayRefreshToken: null, isLoggedIn: true });
  useSettingsStore.setState({ ttsEnabled: false, aiVoiceMode: false, reduceMotion: false });
  const at = Date.now();
  const roles = ['星遥', '林栀', '顾策', '月见', '温川', '晓来', '清和'].map((name, i) => fakeCharacter(`mist-role-${i}`, name, owner, { avatar: art(['#648584','#8c687a','#5e7892'][i % 3], name[0]) }));
  await db.characters.bulkPut(roles);
  const moments = Array.from({ length: 24 }, (_, i) => ({ id: `mist-post-${i}`, userId: owner, authorCharacterId: i === 0 ? undefined : roles[i % 7].id, text: i === 0 ? '雨停了，路边的花也开了。\n想把今天慢慢留下来。' : i === 1 ? '傍晚的风很温柔，城市也变得好看了。' : `把生活里的第 ${i + 1} 个小片段留下来。`, visibility: 'all' as const, audienceCharacterIds: roles.map(r => r.id), visibilityRevision: 1, mediaIds: Array.from({ length: i === 0 ? 3 : i === 1 ? 1 : i === 2 ? 4 : i === 3 ? 9 : 1 }, (_, j) => `mist-media-${i}-${j}`), createdAt: at - i * 3600000, updatedAt: at }));
  await db.moments.bulkPut(moments);
  await db.momentMedia.bulkPut(moments.flatMap((m, i) => m.mediaIds.map((id, order) => ({ id, userId: owner, momentId: m.id, dataUrl: art(['#68939a','#94758c','#94876c'][order % 3], '合成画面', i === 1 ? 500 : 600, i === 1 ? 900 : 600), width: i === 1 ? 500 : 600, height: i === 1 ? 900 : 600, mime: 'image/svg+xml', order, createdAt: at }))));
  await db.momentReactions.bulkPut([
    ...roles.map((role, i) => ({ id: `mist-like-${i}`, userId: owner, momentId: moments[0].id, characterId: role.id, type: 'like' as const, status: 'active' as const, createdAt: at + i, updatedAt: at })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `mist-comment-${i}`, userId: owner, momentId: moments[0].id, characterId: roles[i % 7].id, type: 'comment' as const, status: 'active' as const, content: `第${i + 1}条评论：${i === 7 ? '下次一起去，带上相机。' : '雨后的空气很清爽。'}`, replyToId: i === 7 ? 'mist-comment-1' : undefined, createdAt: at + i, updatedAt: at })),
  ]);
  saveMomentsPreferences(owner, { ...DEFAULT_MOMENTS_PREFERENCES, autonomousPostsEnabled: false });
  let revision = 0;
  const remount = () => root.render(<MomentsPage key={++revision} />);
  (window as any).mistTest = {
    owner, render, remount,
    snapshot: async () => ({ ...counts, moments: await db.moments.where('userId').equals(owner).count(), comments: await db.momentReactions.where('userId').equals(owner).toArray() }),
    refresh: () => window.dispatchEvent(new CustomEvent('virtugene:moments-updated', { detail: { userId: owner } })),
    async comment(content: string) { await db.momentReactions.put({ id: 'mist-later-comment', userId: owner, momentId: 'mist-post-0', characterId: roles[0].id, type: 'comment', status: 'active', content, createdAt: Date.now() + 10000, updatedAt: Date.now() }); this.refresh(); },
    async empty() { await db.moments.where('userId').equals(owner).delete(); remount(); },
    failRead(fail: boolean) { momentsRepo.list = fail ? async () => { throw Error('synthetic read failure'); } : list; remount(); },
    failPublish(fail: boolean) { momentsRepo.create = fail ? async () => { throw Error('synthetic save failure'); } : create; },
    loading() { momentsRepo.list = () => new Promise(() => {}); remount(); },
    cover(orientation: string, density: 'comfortable' | 'compact' = 'comfortable') { saveMomentsPreferences(owner, { ...DEFAULT_MOMENTS_PREFERENCES, autonomousPostsEnabled: false, density, cover: orientation === 'default' ? '' : art('#667f93', '合成封面', orientation === 'portrait' ? 500 : 1000, orientation === 'portrait' ? 900 : 500) }); remount(); },
    longName() { useAuthStore.setState({ username: '这是一个很长很长的合成昵称用于验证自然换行' }); },
    switchOwner() { useAuthStore.setState({ userId: 'moments-mist-other-owner', username: '另一账号' }); },
  };
  render();
  (window as any).mistReady = true;
}
const list = momentsRepo.list.bind(momentsRepo);
const create = momentsRepo.create.bind(momentsRepo);
void boot().catch(error => { (window as any).mistError = String(error); console.error(error); });
