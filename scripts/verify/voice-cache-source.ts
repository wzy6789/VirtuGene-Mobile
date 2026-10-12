import { db, type Character } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { normalizeVoiceLines, validVoiceSamples, voicePromptRevision } from '../../src/lib/character-voice';
import { generateVoiceSamples } from '../../src/lib/ai/character-voice-generator';
import { refreshVoiceSamples, readVoiceSampleCharacter } from '../../src/lib/chat/voice-sample-cache';

async function run() {
  let checks=0, calls=0;
  const check=(value:unknown,label:string)=>{if(!value)throw Error(label);checks++;};
  const lines=(reply:string,input='今天路过江边')=>['称呼：你','判断习惯：先听具体内容，直说自己的想法。','对话样本：用户说你好 → 你说来啦。',`对话样本：用户说${input} → 你说${reply}`];
  const rejected=(value:string[],source='')=>{try{normalizeVoiceLines(value,source);return false;}catch{return true;}};
  for(const reply of ['我上周也去了江边。','我昨天去了。','我一般喝咖啡。','我去过北港旧钟楼。'])check(rejected(lines(reply)),'unsourced compatible-format sample rejected: '+reply);
  for(const reply of ['我也想你。','这个颜色我喜欢。','如果有空，我想去江边走走。','我上周也去了？','我昨天没有去江边。','我上周要是去了就好了。'])check(!rejected(lines(reply)),'feeling, preference, wish or nonassertion allowed: '+reply);
  check(!rejected(lines('我上周也去了江边。'),'经历：我上周也去了江边。'),'authored matching history allowed');
  check(!rejected(lines('我上周去过江边。'),'经历：上周去过江边。'),'matching authored history without pronoun allowed');
  check(!rejected(lines('我上周也去了江边。','陪我演一段江边重逢剧情')),'explicit fictional sample retains dramatic scope');
  check(rejected(lines('我上周也去了江边。'),'对话样本：用户说你好 → 你说我上周也去了江边。'),'another sample cannot supply independent history evidence');
  await db.open();const owner='voice-cache-source-owner';useAuthStore.getState().login(owner,'隔离声音验收','sk-test','');
  let responseLines=lines('我上周也去了江边。');
  const nativeFetch=window.fetch;
  window.fetch=async(url,init)=>{
    if(!String(url).includes('/chat/completions'))throw Error('Unexpected external request');
    const body=JSON.parse(String(init?.body));
    if(!body.messages[0].content.startsWith('只补全角色声音样本'))throw Error('Unexpected generation stage');
    calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({lines:responseLines})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10}}),{headers:{'Content-Type':'application/json'}});
  };
  try {
    for(const [index,persona] of ['现代直率摄影爱好者，与对话者是朋友。','古代谨慎药师，对来客保持礼貌。','原创未来向导，与队友平等相处。','资料稀疏的导入角色，没有指定关系。'].entries()) {
      const character={id:'voice-cache-'+index,createdBy:owner,name:'声音角色'+index,systemPrompt:persona,tags:[],greeting:'',signature:'',createdAt:Date.now()} as Character;
      await db.characters.put(character);
      const before=calls;await refreshVoiceSamples(owner,character.id,'sk-test',{manual:true});
      check(calls===before+1,persona+' one rejected generation does not silently retry');
      check(!(await db.characters.get(character.id))?.voiceSamples,persona+' unsourced generation never writes cache');
      check((await db.characters.get(character.id))?.systemPrompt===persona,persona+' original persona remains unchanged');
      let error=false;try{await generateVoiceSamples(character,'sk-test');}catch{error=true;}
      check(error,persona+' manual generator applies the same evidence gate');
      const stale={lines:responseLines,generatedAt:Date.now(),promptRevision:voicePromptRevision(character)};
      await db.characters.update(character.id,{voiceSamples:stale});
      check(!validVoiceSamples({...character,voiceSamples:stale}),persona+' old compatible-format cache becomes unusable');
      check(!(await readVoiceSampleCharacter(character,owner)).voiceSamples,persona+' runtime cache reader never exposes old unsourced sample');
      check((await db.characters.get(character.id))?.voiceSamples?.lines.join('\n')===stale.lines.join('\n'),persona+' old cache is retained in storage for review');
      const sourced={...character,systemPrompt:persona+'\n经历：我上周也去了江边。'};
      await db.characters.put(sourced);await refreshVoiceSamples(owner,character.id,'sk-test',{manual:true});
      check(!!validVoiceSamples((await db.characters.get(character.id))!),persona+' matching original history permits new cache');
      responseLines=lines('这个颜色我喜欢。');
      const neutral={...character,id:character.id+'-neutral'};await db.characters.put(neutral);
      await refreshVoiceSamples(owner,neutral.id,'sk-test',{manual:true});
      check(!!validVoiceSamples((await db.characters.get(neutral.id))!),persona+' reaction-only samples remain available to new characters');
      responseLines=lines('我上周也去了江边。');
    }
  } finally {window.fetch=nativeFetch;}
  return {checks,mockedCalls:calls};
}
(window as any).voiceSourceChecks={run};
