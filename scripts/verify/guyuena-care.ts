import { db, type Character, type MemoryItem, type Session, type Message } from '../../src/db';
import { initSeedCharacters } from '../../src/lib/seed-init';
import { reviseGuYueNaPresetPrompt, withGuYueNaCare } from '../../src/lib/gu-yue-na-personality';

const report = window.fetch.bind(window);
let count = 0;
function check(ok: unknown, label: string): void { if (!ok) throw Error(label); count += 1; }

async function run(): Promise<void> {
  await db.delete(); await db.open();
  const original = {
    id: 'owned', createdBy: 'owner', name: '我的古月娜', avatar: '🌙',
    systemPrompt: '用户自己加的性格要求：爱看书。', sourcePresetId: 'preset-guyuena',
    tags: ['我的标签'], signature: '我的签名', greeting: '原来开场',
    createdAt: 1, isPreset: false, isCustom: true,
  } as Character;
  const oldGreeting = '……你是谁？我在找一个人。他叫唐舞麟——我等了他很久，也找了他很久。你……见过他吗？';
  const legacy = {
    ...original, id: 'legacy', greeting: oldGreeting,
    systemPrompt: '用户自己补充：喜欢书店。\n**【此刻的节点】**你正在寻找唐舞麟。\n**【相认反应（至关重要）】**先问他是否真的是唐舞麟。\n**【确认之后】**重新相认。\n【与舞麟的共同记忆】\n- 极北·永冻：唐舞麟用黄金龙枪刺入你的心脏。\n- 万年后·重逢：初次重逢。\n- 说话风格（两副嗓子）：用强硬命令表达爱。\n- 称呼：叫他"舞麟"或直呼"唐舞麟"；绝不对其他人亲近\n',
  } as Character;
  const anotherOwner = { ...legacy, id: 'another-owner', createdBy: 'another-user' };
  await db.characters.bulkAdd([original, legacy, anotherOwner, { ...original, id: 'unrelated', sourcePresetId: undefined }]);
  await db.sessions.add({ id: 'session', userId: 'owner', characterId: 'owned', type: 'private', summary: '已有摘要', createdAt: 1, updatedAt: 1 } as Session);
  await db.messages.add({ id: 'message', sessionId: 'session', role: 'user', content: '我要去商场', createdAt: 1 } as Message);
  await db.memories.add({ id: 'memory', userId: 'owner', characterId: 'owned', content: '用户喜欢桂花糕', type: 'auto', createdAt: 1 } as MemoryItem);
  const snapshot = JSON.stringify(await Promise.all([db.sessions.toArray(), db.messages.toArray(), db.memories.toArray(), db.memoryClaims.toArray(), db.characterStates.toArray()]));
  await initSeedCharacters();
  const updated = (await db.characters.get('owned'))!;
  const migrated = (await db.characters.get('legacy'))!;
  const preset = (await db.characters.get('preset-guyuena'))!;
  check(updated.systemPrompt.startsWith(original.systemPrompt), 'user-added personality preserved');
  check(updated.systemPrompt.includes('已婚') && updated.systemPrompt.includes('立刻相信'), 'married timeline and immediate trust');
  check(updated.systemPrompt.includes('舞麟是爱人') && updated.systemPrompt.includes('对其他人保持冷淡'), 'spouse, family and outsiders separated');
  check(updated.systemPrompt.includes('可以偶尔傲娇') && updated.systemPrompt.includes('具体处境'), 'warmth with occasional tsundere, grounded in current situation');
  check(updated.systemPrompt.includes('引述别人的话') && updated.systemPrompt.includes('不算自称'), 'quotes do not imply identity');
  check(updated.systemPrompt.includes('私聊、群聊、星域与朋友圈'), 'same personality in all modes');
  check(updated.systemPrompt.includes('可以偶尔叫“老公”') && updated.systemPrompt.includes('不每句话都加称呼'), 'intimate address remains situational');
  check(updated.systemPrompt.includes('不让他不断猜') && updated.systemPrompt.includes('不是背诵原著台词'), 'confirmed affection without rote quotations');
  check(updated.systemPrompt.includes('普通私聊保持像发消息') && updated.systemPrompt.includes('不是新增共同经历'), 'chat style does not invent memories');
  check(updated.systemPrompt.includes('历史聊天、用户的偏好、约定') && updated.systemPrompt.includes('不据此否定当前婚姻关系'), 'real memories remain valid while old preset timeline cannot override marriage');
  const anotherMigrated = (await db.characters.get('another-owner'))!;
  check(anotherMigrated.systemPrompt === migrated.systemPrompt && anotherMigrated.createdBy === 'another-user', 'migration applies to every local owner without changing ownership');
  check(migrated.systemPrompt.startsWith('用户自己补充：喜欢书店。'), 'owned copy additions retained');
  check(migrated.systemPrompt.includes('婚后相处') && !migrated.systemPrompt.includes('先问他是否真的是唐舞麟'), 'legacy search and identity test removed');
  check(!migrated.systemPrompt.includes('极北·永冻') && !migrated.systemPrompt.includes('黄金龙枪'), 'legacy spear paragraph removed');
  check(migrated.greeting !== oldGreeting && updated.greeting === original.greeting, 'only known old greeting migrated');
  check(!preset.systemPrompt.includes('极北·永冻') && !preset.systemPrompt.includes('黄金龙枪'), 'current preset excludes spear lore');
  check(preset.systemPrompt.includes('婚后的日子') && !preset.greeting.includes('我在找一个人'), 'preset starts after marriage');
  const withoutPrompt = ({ systemPrompt, ...rest }: Character) => rest;
  check(JSON.stringify(withoutPrompt(updated)) === JSON.stringify(withoutPrompt(original)), 'unrelated owned fields unchanged');
  check((await db.characters.get('unrelated'))?.systemPrompt === original.systemPrompt, 'unrelated character untouched');
  check(snapshot === JSON.stringify(await Promise.all([db.sessions.toArray(), db.messages.toArray(), db.memories.toArray(), db.memoryClaims.toArray(), db.characterStates.toArray()])), 'history, saved memories and relationship state unchanged');
  check(withGuYueNaCare(updated.systemPrompt) === updated.systemPrompt && reviseGuYueNaPresetPrompt(migrated.systemPrompt) === migrated.systemPrompt, 'personality revisions idempotent');
  await initSeedCharacters();
  check((await db.characters.get('legacy'))?.systemPrompt === migrated.systemPrompt, 'repeated startup never stacks rules');
  await report('/result?suite=guyuena-care', { method: 'POST', body: `ok ${count} assertions\nALL PASS` });
}
run().catch(async (error) => {
  await report('/result?suite=guyuena-care', { method: 'POST', body: `FAIL ${error.stack}\n1 FAILED` });
});
