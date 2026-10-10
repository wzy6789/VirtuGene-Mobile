import {build} from 'esbuild';
import {createRequire} from 'node:module';
const bundle=await build({stdin:{contents:`
import {selectVoiceExamples,interactionMoment,voiceExampleUserText} from './src/lib/chat-emotional-expression';
import {topicTerms} from './src/lib/chat-conversation-state';
const input='我不是说故意去找剧透，就是碰巧知道了，也还是想看人物怎么走到那里。';
const samples=['对话样本：用户说我是舞麟，今天就是想你了 → 你说嗯，我也想你。','对话样本：用户说你偏爱热闹还是安静 → 你说安静一点。这样想说什么，都能听清。'];
const sample=voiceExampleUserText(samples[0]);
const topic=sample.replace(/^我是舞麟[，,。]\\s*/u,'');
console.log(JSON.stringify({inputMoment:interactionMoment(input),rawSample:sample,sampleMoment:interactionMoment(sample),topicMoment:interactionMoment(topic),overlap:[...topicTerms(topic)].filter(term=>topicTerms(input).has(term)),selected:selectVoiceExamples(samples,input,{allowUnrelatedNeutral:false,identityNames:['唐舞麟','舞麟']})},null,2));
`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent'});
new Function('require',bundle.outputFiles[0].text)(createRequire(import.meta.url));
