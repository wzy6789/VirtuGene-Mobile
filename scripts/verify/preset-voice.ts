import {db} from '../../src/db';
import {PRESET_CHARACTERS,initSeedCharacters} from '../../src/lib/seed-init';
import {knownOriginalPresetVoicePrompts,reviseOriginalPresetVoice,reviseOriginalPresetCard} from '../../src/lib/original-preset-voice';
import {buildCharacterVoiceCard} from '../../src/lib/chat-humanizer';
import {voicePromptRevision} from '../../src/lib/character-voice';
import {fakeCharacter} from './world-harness';

async function run() {
  let checks=0;
  const ok=(value:unknown,label:string)=>{if(!value)throw Error(label);checks++;console.log('ok '+label);};
  await db.delete();await db.open();
  window.fetch=async()=>{throw Error('Preset revision must use zero network calls');};
  const ids=['preset-linshuang','preset-aili','preset-socrates','preset-guqinghan','preset-xiawanxing'];
  const originals=ids.map(id=>PRESET_CHARACTERS.find(c=>c.id===id)!);
  const priorCopies:Array<{id:string;sourceId:string;prompt:string}>=[];
  for(const original of originals) {
    const revised=reviseOriginalPresetVoice(original.systemPrompt,original.id);
    ok(revised!==original.systemPrompt&&revised.includes('判断习惯：')&&revised.split('对话样本：').length===4,`${original.name} gains concrete judgment and three distinct scenes`);
    ok(reviseOriginalPresetVoice(revised,original.id)===revised,`${original.name} revision is idempotent`);
    const introPreserved=original.id==='preset-xiawanxing'?revised.split('\n')[0].startsWith('你是夏晚星，'):revised.split('\n')[0]===original.systemPrompt.split('\n')[0];
    ok(introPreserved&&revised.includes('- 称呼：'),`${original.name} retains its identity and address; only the gentle source introduction is revised`);
    await db.characters.add(fakeCharacter('owned-'+original.id,original.name,'owner',{sourcePresetId:original.id,systemPrompt:original.systemPrompt}));
    for(const [index,prompt] of knownOriginalPresetVoicePrompts(original.systemPrompt,original.id).entries()) {
      if(prompt===original.systemPrompt||prompt===revised)continue;
      const id=`previous-${original.id}-${index}`;
      priorCopies.push({id,sourceId:original.id,prompt});
      await db.characters.add(fakeCharacter(id,original.name,'owner',{sourcePresetId:original.id,systemPrompt:prompt}));
      await db.characters.add(fakeCharacter(id+'-edited',original.name,'owner',{sourcePresetId:original.id,systemPrompt:prompt+'\n用户补充：只聊我的兴趣。'}));
      await db.characters.add(fakeCharacter(id+'-published',original.name,'owner',{published:true,sourcePresetId:original.id,systemPrompt:prompt}));
      await db.characters.add(fakeCharacter(id+'-secretary',original.name,id+'-assistant-owner',{agentProfile:'secretary',sourcePresetId:original.id,systemPrompt:prompt}));
    }
  }
  const source=originals[0];
  const catSource=originals[2],catPrompt=reviseOriginalPresetVoice(catSource.systemPrompt,catSource.id);
  for(const [id,patch] of [
    ['cat-card-old',{}],
    ['cat-card-edited',{greeting:'我自己写的开场',signature:'我自己写的签名'}],
    ['cat-card-opening-edited',{greeting:'专门给我的问候'}],
    ['cat-card-prompt-edited',{systemPrompt:catPrompt+'\n用户增加：不要讲哲学。'}],
    ['cat-card-published',{published:true}],
  ] as const)await db.characters.add(fakeCharacter(id,catSource.name,'owner',{sourcePresetId:catSource.id,systemPrompt:catPrompt,greeting:catSource.greeting,signature:catSource.signature,...patch}));
  await db.characters.add(fakeCharacter('edited','我的林霜','owner',{sourcePresetId:source.id,systemPrompt:source.systemPrompt+'\n用户补充：不要谈代码。'}));
  await db.characters.add(fakeCharacter('published','公开林霜','owner',{published:true,sourcePresetId:source.id,systemPrompt:source.systemPrompt}));
  await db.characters.add(fakeCharacter('unrelated','自定义人物','owner',{systemPrompt:source.systemPrompt}));
  await db.sessions.add({id:'kept-session',userId:'owner',characterId:'owned-'+source.id,title:'旧聊天',createdAt:1,updatedAt:1});
  await db.messages.add({id:'kept-message',sessionId:'kept-session',role:'user',content:'旧聊天内容',isProactive:false,createdAt:1});
  const ownedBefore=await db.characters.get('owned-'+source.id);
  await initSeedCharacters();
  for(const original of originals) {
    const expected=reviseOriginalPresetVoice(original.systemPrompt,original.id);
    ok((await db.characters.get(original.id))?.systemPrompt===expected,`${original.name} shipped preset uses revised source`);
    ok((await db.characters.get('owned-'+original.id))?.systemPrompt===expected,`${original.name} exact untouched copy upgrades`);
    const card=buildCharacterVoiceCard({...original,systemPrompt:expected},'你有不同意见吗？');
    ok(card.includes('人物判断依据')&&!card.includes('语言指纹与判断：'),`${original.name} concrete authored judgment precedes generic personality fallback`);
  }
  const ownedAfter=await db.characters.get('owned-'+source.id);
  ok(priorCopies.length===9,'three previous cat revisions, two architect and gentle revisions and the prior swordsman and traveler revisions are covered');
  for(const copy of priorCopies) {
    const original=originals.find(item=>item.id===copy.sourceId)!;
    ok((await db.characters.get(copy.id))?.systemPrompt===reviseOriginalPresetVoice(original.systemPrompt,original.id),'an exact previously upgraded copy receives the current voice');
    ok((await db.characters.get(copy.id+'-edited'))?.systemPrompt===copy.prompt+'\n用户补充：只聊我的兴趣。','a user addition to a prior version is preserved');
    ok((await db.characters.get(copy.id+'-published'))?.systemPrompt===copy.prompt,'a published prior version is preserved');
    ok((await db.characters.get(copy.id+'-secretary'))?.systemPrompt===copy.prompt,'an assistant is never silently converted by voice migration');
  }
  const lin=reviseOriginalPresetVoice(source.systemPrompt,source.id);
  ok(!lin.includes('嘴上嫌弃却')&&lin.includes('分歧反应：')&&lin.includes('不点评他终于想通')&&lin.includes('不必每件事都有改进方案'),'architect identity targets concrete views without importing disdain, grading or automatic life coaching');
  const cat=reviseOriginalPresetVoice(originals[2].systemPrompt,originals[2].id);
  const revisedCard=reviseOriginalPresetCard(catSource,catSource.id);
  for(const id of [catSource.id,'cat-card-old']){
    const actual=(await db.characters.get(id))!;
    ok(actual.greeting===revisedCard.greeting&&actual.signature===revisedCard.signature,'shipped and exact untouched owned cat cards receive the non-interrogating opening');
    ok(!buildCharacterVoiceCard(actual,'你知道我今天几点起床的吗').includes('猫在观察你'),'actual cached-character voice card no longer imports the legacy observation frame');
  }
  const customized=(await db.characters.get('cat-card-edited'))!;
  ok(customized.greeting==='我自己写的开场'&&customized.signature==='我自己写的签名','custom opening and signature remain unchanged');
  const partialCard=(await db.characters.get('cat-card-opening-edited'))!;
  ok(partialCard.greeting==='专门给我的问候'&&partialCard.signature===revisedCard.signature,'an edited opening is preserved while the exact old source signature can upgrade');
  for(const id of ['cat-card-prompt-edited','cat-card-published']){
    const actual=(await db.characters.get(id))!;
    ok(actual.greeting===catSource.greeting&&actual.signature===catSource.signature,'edited persona and published cat cards retain their source metadata');
  }
  ok(lin.includes('你说选书。')&&cat.includes('你说我偏装修。'),'the same everyday question has distinct authored preferences rather than universal advice');
  ok(!cat.includes('用反问句引导思考')&&!cat.includes('对浅薄的问题不耐烦'),'the cat no longer receives conflicting teacher and classroom rules');
  ok(!cat.includes('今天不考你了')&&cat.includes('还没听完就下结论')&&cat.includes('不靠连续比喻'),'cat samples express a specific reaction without importing a teacher or ornate speech into tired conversation');
  const swordsman=reviseOriginalPresetVoice(originals[3].systemPrompt,originals[3].id);
  ok(!swordsman.includes('听见了。不必勉强说下去')&&swordsman.includes('用户说今天很累 → 你说嗯。')&&swordsman.includes('是否继续由用户决定'),'quiet swordsman retains a pure reaction without importing a decision to stop speaking');
  const traveler=reviseOriginalPresetVoice(originals[1].systemPrompt,originals[1].id);
  ok(!traveler.includes('冷场时抛出有趣的问题')&&traveler.includes('真的有一处好奇再问')&&traveler.includes('混搭路线'),'curious traveler has a concrete reaction sample without a compulsory interview strategy');
  const gentle=reviseOriginalPresetVoice(originals[4].systemPrompt,originals[4].id);
  ok(!gentle.includes('把每一份心事都妥帖收好')&&!gentle.includes('记得对方的痛点')&&gentle.includes('日常小事')&&gentle.includes('会轻轻开玩笑'),'gentle source identity can enjoy ordinary conversation rather than treating every topic as a disclosure');
  ok(gentle.includes('不喜欢一件事也会说出来')&&gentle.includes('蓝色我也挺喜欢')&&gentle.includes('对小事也有自己的偏好'),'gentle voice keeps a concrete preference and disagreement without requiring constant soothing');
  ok(gentle.includes('分歧反应：')&&gentle.includes('道歉修复：')&&!gentle.includes('先说你愿意说的那一点'),'gentle voice uses concrete clarification and apology habits instead of a standing invitation to disclose feelings');
  ok(ownedAfter?.name===ownedBefore?.name&&ownedAfter?.createdBy===ownedBefore?.createdBy&&ownedAfter?.avatar===ownedBefore?.avatar,'owned revision keeps name, owner and avatar');
  ok((await db.characters.get('edited'))?.systemPrompt===source.systemPrompt+'\n用户补充：不要谈代码。','edited owned persona remains byte-for-byte unchanged');
  ok((await db.characters.get('published'))?.systemPrompt===source.systemPrompt,'published copy is not silently revised');
  ok((await db.characters.get('unrelated'))?.systemPrompt===source.systemPrompt,'unrelated character is not changed by matching text alone');
  ok((await db.messages.get('kept-message'))?.content==='旧聊天内容'&&(await db.sessions.get('kept-session'))?.title==='旧聊天','existing chats and sessions survive preset upgrade');
  ok(voicePromptRevision(ownedBefore!)!==voicePromptRevision(ownedAfter!),'owned persona revision invalidates prior voice cache hash');
  await initSeedCharacters();
  ok((await db.characters.get('owned-'+source.id))?.systemPrompt===ownedAfter?.systemPrompt,'repeated startup does not duplicate voice samples');
  return {checks};
}
(window as any).presetVoiceTest={run};
