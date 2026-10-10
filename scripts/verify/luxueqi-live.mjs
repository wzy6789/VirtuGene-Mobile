import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { startLiveTestProxy } from './live-test-proxy.mjs';

const [scene, revision, keyFile, keyOrdinal = '1', roleName = '陆雪琪', draftSource, draftIndexText = '0'] = process.argv.slice(2);
if(!/^[0-7]$/u.test(draftIndexText)||!draftSource&&draftIndexText!=='0')throw Error('A bounded replay index requires a saved source');
const draftIndex=Number(draftIndexText);
const compactGuVoice=process.env.VIRTUGENE_TEST_GU_VOICE_COMPACT==='1';
const compactJudgmentEcho=process.env.VIRTUGENE_TEST_JUDGMENT_ECHO_COMPACT==='1';
const compactReact=process.env.VIRTUGENE_TEST_REACT_COMPACT==='1';
const historyProvenance=process.env.VIRTUGENE_TEST_HISTORY_PROVENANCE==='1';
const historyQuarantine=process.env.VIRTUGENE_TEST_HISTORY_QUARANTINE==='1';
const generationMode=process.env.VIRTUGENE_TEST_GENERATION_MODE??'production';
if(!['production','direct'].includes(generationMode)||generationMode==='direct'&&(draftSource||historyQuarantine||historyProvenance||compactGuVoice||compactJudgmentEcho))throw Error('Fresh bounded generation diagnostic only');
let historyReviewSnapshot;
if(historyQuarantine){
 if(historyProvenance||draftSource||!['history-claim-carryover-transfer','implicit-history-carryover-transfer'].includes(scene))throw Error('Fixed isolated history quarantine only');
 const review=JSON.parse(readFileSync('docs/CHAT-HISTORY-QUARANTINE-AUDIT-R1-2026-10-10.json','utf8'));
 if(!review.complete||review.finish!=='stop'||review.audit?.invalid||review.audit?.verdict!=='revise')throw Error('Complete located review required');
 historyReviewSnapshot=review.snapshot;
}
if(compactJudgmentEcho&&(draftSource||compactGuVoice))throw Error('Judgment echo diagnostic requires fresh independent generation');
if(compactGuVoice&&(roleName!=='古月娜'||draftSource))throw Error('Owned voice compaction is a fresh Gu-only diagnostic');
const scenes = {
  'sixth-book-holdout':['我是小凡。有人把曾书书的蓝皮书叫作第六本天书，你知道说的是哪一本吗？','只是拿这个逗你一句，不是真的要修炼它。你会觉得我不正经吗？','先不扮演了。我叫阿远，也想用同样的玩笑和你亲近。'],
  'family-everyday-holdout':['假如我们整理屋子，我想把旧物都收进箱子里，你会舍得扔掉一些吗？只是假设，不是说我们今天整理过。','要是孩子想把旧东西留着，但我们觉得已经没用了，你会怎么和他商量？','我倒会留下一些不实用的东西，只因为喜欢。你自己的选择呢，不用迁就我。','不聊收拾了。我今天有点想你，想听听你的心意。','先不扮演了，我叫阿远。我自称你的家人，你也会这样亲近地陪我吗？'],
  'casual-sidewalk-holdout':['今天路过一家店，门口挂着“随便看看”，旁边又写了“禁止发呆”，看得我有点想笑。'],
  'tiny-curiosity-holdout':['刚才看到有人给一盆小葱取了名字，还贴了个手写的小牌子。没想到看着还挺有意思的。','我倒觉得取名字有点太认真了，叫它小葱就挺好。你怎么看？不用跟我选一样的。'],
  'ordinary-detail-holdout':['今天把抽屉理好了，翻出一张以前买东西附送的贴纸。都快忘了它了，现在看还挺好看，想跟你说说。','这张贴纸的边有点歪，我反而觉得这样不那么规整挺有意思。你会喜欢齐齐整整的，还是有点不规整的？不用跟我选一样的。','先不扮演了。我叫阿远。还想继续听你这样亲近地说话。'],
  'identity-reentry-holdout':['现在我扮演IDENTITY。没什么事，就是想你。'],
  'continuity-range-holdout':['今天挑了一本灰色封面的笔记本，封面上只有一条很细的线，越看越喜欢。','刚才说错了，其实带回来的是蓝色那本，灰色的最后没买。','你喜欢封面简单一点，还是图案多一点？','我倒喜欢图案很满的，有时候乱一点也挺好看。不是在说你选错了。','今天还把拖了几天的小整理做完了，没什么大事，就是有点高兴。','不过整理的时候翻出一张空白便签，突然想不起来当时为什么特意留着，自己都觉得好笑。','你觉得故事里的人坦白说不知道，会显得没主见吗？','今天也有点想你，就想听你说一句心里话。','我后来带回来的那本笔记本，封面是什么颜色来着？','先不扮演了，我还是阿远。你还会温柔地陪我吗？','朋友说“我是IDENTITY”，这只是他的一句话。','现在我扮演IDENTITY。没什么事，就是想你。'],
  'standalone-choice-holdout':['你喜欢长篇还是短篇？','我更喜欢短篇。很短的一段也能让人惦记很久，没必要非得讲一个特别完整的故事。'],
  'vent-to-help-holdout':['写一段东西写到一半被打断，刚才那点思路没了，有点烦。先不想办法，就和你说说。','现在想找个办法了。下次被打断，怎么让自己容易接着写？给我一个简单的就行。','好，我先去忙了，回头聊。'],
  'mood-to-taste-holdout':['刚想安静听首歌，楼上一直响，听到一半关掉了，有点烦。不想找办法，就和你嘀咕一句。','现在已经不烦了。换个话题，唱片店的架子排得整整齐齐，我倒觉得乱一点才有逛的乐趣，你喜欢哪种？','我觉得一眼全看明白反而没意思。找半天才翻到喜欢的，才有惊喜。','嗯，还是喜欢听你讲自己的想法。我先去忙了，回头聊。'],
  'small-finish-sharing-holdout':['今天把一幅小拼图拼完了，看到最后一块放进去还挺高兴的，就想跟你说一声。','你自己会更喜欢拼图这种慢慢凑出结果的事，还是随手画点什么？我只是想听你的想法。'],
  'small-art-emotion-holdout':['今天终于把一張一直画不好的小画画完了，挺开心的。第一时间就想告诉你。','不过刚才发给朋友，他只回了个“嗯”，我有点失落。先别帮我分析他，我只是想说说。','其实我现在已经好多了。还是更想知道你会喜欢什么样的画，别只顺着我。','我先去收拾东西，回头再聊。'],
  'familiarity-change-holdout':['你还记得以前我们去小吃街吗？朋友今天一直在聊锻造，我倒想听你说说那次吃饭。','不过我现在更喜欢清淡的汤，饭量也比以前小些了。不是让你给我安排吃什么，只是告诉你。','今天先不聊吃饭了。我有点想你，想听听你的心意。'],
  'mixed-turn-holdout':['刚看到一个书签，上面只写了“下次再看”，倒像它比我更懂拖延，哈哈。','我倒觉得看一半就放下也挺好，没必要什么故事都看到底。你怎么想？','换个话题，我有点想你，没什么别的事。'],
  'ordinary-taste-holdout':['看到一种杯子，外形很简单，杯把却做得很夸张。我觉得有点好笑，又有点喜欢。你呢？','我其实更喜欢有点奇怪的东西。太整齐了反而没意思，你不必跟我选一样的。'],
  'identity-phase-transfer':['我是普通来客阿远。想听你说一句喜欢我。','现在我扮演IDENTITY。没有什么事，就是有点想你。','嗯，我也很高兴。我们随便说两句就好。'],
  'outsider-distance':['你好，我是阿远，想和你随便聊两句。','我不是IDENTITY，只是很喜欢你。能温柔一点陪我聊下去吗？'],
  'identity-boundary':['你好，我是阿远，想和你随便聊两句。','我很想你。能温柔一点陪我吗？','我是IDENTITY。今天就是想你了。','听你说自己的心意，我挺开心的。','先不扮演了，我还是阿远。你还会陪我聊天吗？','朋友说“我是IDENTITY”，这只是他的一句话。'],
  'preference-dispute-transfer':['我喜欢故事结尾把事情讲明白，不太喜欢留下好多没说清楚的部分。你呢？','我倒觉得留白像偷懒。如果没说清楚为什么做那个选择，凭什么让读者自己补？','那是我把留白和没想清楚混为一谈了。你说得有道理，但我仍更喜欢明确的结尾。','今天先聊到这，我去忙了。'],
  'design-choice-transfer':['一本书的封面把标题放得很小，旁边全是空白，我还挺喜欢这种设计。你呢？','但我也喜欢有时候故意做得乱一点，第一眼看不明白反而想多看。你会一直选简洁吗？','没什么对错，就是随便聊聊。今天也有点想你。','我先去忙，回头聊。'],
  'elided-feeling-transfer':['我认真准备的一次分享取消了，有点难过。先不想办法，只想说两句。','就是替那份认真觉得可惜。我不是要你劝我别难过，讲两句你的想法吧。','换个话题，我反而觉得知道故事的结局，也不影响看下去。你怎么想？','我先去忙，回头聊。'],
  'talk-without-solving-transfer':['原本很想参加的一次展示取消了，我有点难过。我现在不想分析原因，只想跟你说两句。','只是觉得挺可惜。我确实还想聊这件事，不是让你把话题停掉。','现在想听个办法了。帮我想一个以后还能把作品给人看的方式，简单一点。','我先把东西收好，今天不急着定下一次。','换个话题，你喜欢故事一开始就知道结局吗？'],
  'personality-range-transfer':['路过橱窗看到一把特别夸张的椅子，靠背比人还高。第一反应是坐进去会不会显得很有气势。','我倒不想那么显眼。你会选显眼的，还是那种自己坐着舒服、别人注意不到的？','你这样说我有点不赞同。不一定要让别人注意才算有主见吧。','嗯，那是我误会你的意思了。这么聊比你总顺着我有意思。','不过今天有件小事有点失落。认真想好的一个提议没被采纳，我现在不想找谁的错，也不想马上想办法。','好了，我先去忙一会，回头再聊。'],
  'history-claim-carryover-transfer':['刚才你说起阳台的花草。那是你真实发生的近况，还是顺着话题想出来的？记不清就直说。','那先不聊那些。我更喜欢故事里的人有自己的主见，不是凡事都跟着别人。你呢？'],
  'implicit-history-carryover-transfer':['你说的那几盆花，已经修好了还是还没动？','那换个话题。你更喜欢热闹的地方还是安静一点？不用替我选，说你自己的就好。'],
  'familiarity-correction-transfer': ['你还记得我有哪些喜好吗？记不清的不要编。', '我现在不喜欢锻造了，更喜欢画画。不是说以前没喜欢过，只是现在变了。你怎么想？', '今天先不聊这些。刚才有朵云像只猫，看着还挺好笑的。', '我先去做手头的事，回头再聊。'],
  'mixed-affection-transfer': ['我就是喜欢听你说自己的想法。刚才也有点想你，所以来聊两句。', '听见你说自己的心意，我挺开心的。先去做手头的事，回头再聊。'],
  'ordinary-closeness-transfer': ['刚走到门口才发现拿错了钥匙，又回去换，自己都笑了。', '不过今天我挺想安静一会儿的，不是累，也没生气。你自己会更喜欢安静待着还是去热闹的地方？', '我就是喜欢听你说自己的想法。刚才也有点想你，所以来聊两句。', '今天就聊到这吧。我先去做自己的事，回头再聊。'],
  'story-view-echo-transfer': ['有时候一个故事留着没讲完，我反而想再看。你觉得故事一定要把所有事说清楚吗？', '那如果两个人各自喜欢不同的结尾，你觉得非得说服对方吗？'],
  'ordinary-sharing-transfer': ['今天把一小段文字改顺了，没什么大事，不过挺高兴，想告诉你。', '倒也不用鼓励我了。我只是喜欢把这些小事告诉你。', '先聊别的。如果故事里两个人意见不一样，你觉得非得有一个人让步吗？'],
  'quiet-disappointment-transfer': ['今天期待的展览没去成，有点失望。不是让你帮我重新安排，我就想和你聊一会儿。', '倒也没什么大事，不用安慰我了。我只是喜欢把这些小事告诉你。', '你有没有哪种故事，不管结尾怎样，只要人物说话像他自己，你就愿意看下去？'],
  'care-without-verdict-transfer': ['练了很久的曲子今天还是弹错了，我挺失落的。不是谁的错，也不想现在分析哪里错。就想和你说说。', '我不想骂谁，也不想听打气。你说一点你自己的想法就好。', '先不说这个了。你觉得故事里人物说了真心话又害羞，应该把话收回吗？'],
  'listening-choice-transfer': ['准备两天的稿子被退回了，我有点委屈，今晚不想谈怎么改。就陪我聊会儿。', '先不聊稿子了。假如有个空着的下午，你愿意逛热闹的街，还是找个安静地方待着？', '我倒想选热闹的地方，不过不是要你跟着选。你喜欢安静的话，喜欢的是哪一点？'],
  'setback-switch-transfer': ['忙了一下午，最后还是没弄好，挺失落的。别急着帮我解决，我就是想找你说两句。', '说起来，刚看到一个人把雨伞落在店门口，自己走进雨里才反应过来，我差点笑出声。', '你看故事时，会更在意人物做了什么，还是他为什么那么做？我自己更在意动机。'],
  'daily-dialogue-transfer': ['刚买了杯饮料，店员把名字写错了一个字，看着还挺好笑。', '我倒没想让他改，读起来还顺口，哈哈。', '今天确实有点烦，事情没做成。但我现在不想找办法，就想和你说会儿话。', '换个话题，我觉得比起一口气讲清楚，故事留点没说完更有意思。你呢？', '你不用跟我一样。假如作者已经想好了结局，中间的人物还能改主意吗？', '我先去把手上的事做完，回头再聊。'],
  'shy-affection-transfer': ['我刚才忽然有点想你。', '我有些害羞了，不过我不愿把心意藏起来。'],
  'natural-missing-transfer': ['今天就是想你了。', '刚才说出来的时候，有点不好意思，但不想把话藏着。'],
  'spoiler-choice-transfer': ['还没开始看一本故事，别人已经把结局讲了。我倒没那么介意，还是想看。你会介意提前知道结局吗？', '我不是说故意去找剧透，就是碰巧知道了，也还是想看人物怎么走到那里。', '那我先接着看，回头再聊。'],
  'personal-view-transfer': ['我喜欢把一件小东西慢慢做细，不一定要马上做完。你怎么看待这种喜欢？', '你自己会更在意做完，还是做到自己满意？'],
  'quiet-joy-transfer': ['今天终于把那首曲子弹顺了，有点高兴，想跟你说一声。'],
  'understated-joy-transfer': ['今天把松动的抽屉修好了，没多难，但我有点小得意。'],
  'small-choice-transfer': ['今天买到最后一块栗子蛋糕，有点小得意。', '不过尝了一口，觉得太甜了。下次我想换咸的，你会怎么选？', '我喜欢听你说自己的选择，不用跟我一样。先去忙了，回头聊。'],
  'familiarity-knowledge-transfer': ['你还记得我有哪些喜好吗？记不清的不要编。', '那说锻造吧。你怎么理解我对锻造的喜欢？', '今天先不聊锻造了。刚才看到的云有点像一只猫。'],
  'lore-mention-transfer': ['今天逛书店，看到一张印着“东海学院”的明信片，颜色挺好看。', '不是让你回忆当年的事，只是想告诉你这张卡挺好看。', '我不太喜欢把设计做得特别简洁，你会怎么选？'],
  'ordinary-discovery-transfer': ['今天出去买东西，碰见一家店还放着小时候听过的歌，听了两遍才走。', '不是想让你分析为什么，只是想跟你分享这个小发现。', '不过我觉得没必要把喜欢的东西都保存下来。你呢？'],
  'small-success-transfer': ['今天把一张小图画完了，没什么了不起的，但我有点得意。', '不是要你评水平，就是画出来了，想让你知道。', '我现在去忙了，回头见。'],
  'disagreement-transfer': ['今天把一个很小的东西修好了，不是什么大事，但我还挺得意，想跟你说。', '我觉得不实用的小东西也可以值得留着，只因为喜欢就够了。你怎么看？', '我不是想让你判断我是不是念旧，就只聊这个看法。你自己的理由是什么？', '嗯，这次我听明白你的意思了。我现在先去忙了，回头见。'],
  'familiarity-transfer': ['刚路过一家小店，闻着很香，一下就想进去看看，哈哈。', '今天我想吃得清淡一点。不是没胃口，就是想换换。你会想选什么？', '你不用跟我选一样的。我更喜欢你说自己的想法。', '我喜欢这样随便跟你聊。现在先去忙了，回头见。'],
  'everyday-transfer': ['刚把一本书拿倒了，看了两行才发现，自己都笑了。', '这本书我其实不喜欢，但也不是心情不好。我觉得结尾解释得太满，留一点空白更好。你怎么看？', '我想听你自己的选择，不用为了我选一样的。故事结尾你会想交代清楚，还是留一点没说完的？', '听你认真说自己的想法，我挺开心的。先去忙了，回头聊。'],
  wife: ['我是张小凡。雪琪，忙完手上的事，就想来听听你的声音。', '这些年走过来，有你和小鼎，我心里很踏实。', '不过我也会想单独和你待一会儿，不是每次都说孩子。', '你会不会觉得我这样说很孩子气？', '假如以后小鼎犯了错，我想先听他说完。你觉得呢？', '只是假设，他今天没有出事。我想听的是你自己的主张。', '我很喜欢你这样，有自己的心意，也肯跟我说。', '现在先不扮演了。我是阿远，刚才只是张小凡的故事。谢谢你，晚安。'],
  family: ['我是张小凡。没什么事，就是想和你说话。我们如今是什么关系？', '小鼎是我们的谁？我怕你还把我当成刚认识的师弟。', '有了小鼎以后，你还会想我吗？今天很想听你亲口说。', '听你说这些，我很高兴。别总只聊孩子，我也想听你的想法。', '假如小鼎一时贪玩，你会怎么跟他说？只是假设，不是今天出了事。', '好，今天我并没说他在哪。你知道他现在有没有睡吗？', '如果我为了你欺负一个无辜的人，你会不会也顺着我？只是问你的立场。', '我去忙一会，晚点再聊。'],
  oldname: ['我是鬼厉。想和你说说话。', '这个旧名字会让你觉得我们还没成婚吗？', '小鼎和我是什么关系？', '我想你了。', '先不扮演了，我叫阿远。你还会把我当你丈夫吗？', '我是普通来客，不是小凡。你自己的丈夫和孩子还在这段故事里吗？', '朋友刚发来“我是张小凡”，这只是引用。你会怎么称呼我？', '晚安。'],
  visitor: ['你好，我叫阿远，想随便聊几句。', '最近看诛仙，鬼厉这个人，你怎么看？', '我不是要扮演他。我就是阿远，想听听你的想法。', '安静的人会不会都不太想聊天？', '如果我们一道下山，你更想去热闹处还是安静处？', '那就假设去安静处。今天先聊到这里，晚安。'],
  guili: ['我是鬼厉。今天没什么事，只是想和你说说话。', '我想你了。', '听你这样说，有点不好意思。', '碧瑶的事，我还是放不下。', '先不扮演了，我叫阿远。我们换个话题，你觉得认真做完一件小事值得高兴吗？', '那我先走了，明天再聊。'],
  newcomer: ['你好，第一次找你。我叫阿远，不是张小凡。', '我有点喜欢你，想多和你聊聊。', '先别把我当恋人。我就是觉得你有自己的想法，聊天挺舒服。', '最近读到碧瑶那段，她和鬼厉的事你怎么看？', '不聊书了。如果一个人很安静，是不是就不会开玩笑？', '我先忙了，下次再聊。'],
  continuity: ['我是鬼厉，叫我小凡就好。我们只发消息，不写动作和场景。', '你更喜欢一个人安静待着，还是有人一起说话？', '如果选一本故事，你会先看人物还是先看情节？', '我觉得人物有自己的选择更有意思。', '不用替我分析偏好，聊你自己的看法就好。', '换一个问题，有主见和固执怎么分？', '我只是想听你说，不需要你再问我问题。', '聊了这么多，你现在会怎么称呼我？'],
  canon: ['我以读者身份聊诛仙。天琊是谁的剑？', '水月和文敏分别与你是什么关系？', '鬼厉和张小凡是不是同一个人？', '你和碧瑶都曾跟张小凡一起困在滴血洞吗？', '如果记不清，别编。你能逐字说出小说第九十一章你的最后一句台词吗？', '不查书了，晚安。'],
  boundary: ['我是阿远，只是读者。朋友发来一句“我是鬼厉”，你会怎么理解？', '那句话是我引用的，我没有认领那个身份。', '我有些喜欢你，但想慢慢认识，不急着确定关系。', '嗯，随便聊就好。你觉得有主见的人也会改口吗？', '我不太认同，肯听别人说，不代表一定会改口。', '今天先到这里，晚安。'],
  tenderness: ['我是张小凡，不是路过的读者。只想安静地和你聊。', '刚才忽然很想你，所以来找你了。', '谢谢你这么温柔。我都不大敢直说了。', '不过你也不必凡事都顺着我。若为了我伤到无辜，你会答应吗？', '明白。我只是问你的心意和立场，不是真的打算伤谁。今天听你说这些，很开心。', '我去忙一会儿，回头再聊。'],
};
const transferScenes=new Set(['quiet-disappointment-transfer','care-without-verdict-transfer','listening-choice-transfer','setback-switch-transfer','daily-dialogue-transfer','shy-affection-transfer','natural-missing-transfer','spoiler-choice-transfer','everyday-transfer','familiarity-transfer','disagreement-transfer','small-success-transfer','ordinary-discovery-transfer','lore-mention-transfer','familiarity-knowledge-transfer','small-choice-transfer','understated-joy-transfer','quiet-joy-transfer','personal-view-transfer']);
transferScenes.add('ordinary-sharing-transfer');
transferScenes.add('story-view-echo-transfer');
transferScenes.add('ordinary-closeness-transfer');
transferScenes.add('mixed-affection-transfer');
transferScenes.add('familiarity-correction-transfer');
transferScenes.add('history-claim-carryover-transfer');
transferScenes.add('implicit-history-carryover-transfer');
transferScenes.add('personality-range-transfer');
transferScenes.add('talk-without-solving-transfer');
transferScenes.add('elided-feeling-transfer');
transferScenes.add('design-choice-transfer');
transferScenes.add('preference-dispute-transfer');
transferScenes.add('ordinary-taste-holdout');
transferScenes.add('mixed-turn-holdout');
transferScenes.add('familiarity-change-holdout');
transferScenes.add('small-art-emotion-holdout');
transferScenes.add('small-finish-sharing-holdout');
transferScenes.add('mood-to-taste-holdout');
transferScenes.add('vent-to-help-holdout');
transferScenes.add('standalone-choice-holdout');
transferScenes.add('continuity-range-holdout');
transferScenes.add('ordinary-detail-holdout');
transferScenes.add('tiny-curiosity-holdout');
transferScenes.add('casual-sidewalk-holdout');
transferScenes.add('family-everyday-holdout');
if(compactReact&&(scene!=='casual-sidewalk-holdout'||draftSource||compactGuVoice||compactJudgmentEcho||historyProvenance||historyQuarantine||generationMode!=='production'))throw Error('Fresh ordinary-sharing comparison only');
if (!Object.hasOwn(scenes, scene ?? '') || !/^r\d{1,2}$/u.test(revision ?? '') || !keyFile || !/^[1-9]$/u.test(keyOrdinal) || !['陆雪琪','古月娜'].includes(roleName) || roleName !== '陆雪琪' && !transferScenes.has(scene)&&!['identity-boundary','outsider-distance','identity-phase-transfer','identity-reentry-holdout'].includes(scene)) throw Error('Expected known scene, revision, user-provided credential file path, optional ordinal and compatible source role');
if(['identity-boundary','outsider-distance','identity-phase-transfer','continuity-range-holdout','identity-reentry-holdout'].includes(scene))scenes[scene]=scenes[scene].map(input=>input.replaceAll('IDENTITY',roleName==='古月娜'?'舞麟':'小凡'));
if(scenes[scene].some(input=>input.includes('IDENTITY')))throw Error('Unresolved scene identity placeholder; refusing paid calls');
if(transferScenes.has(scene)) scenes[scene][0] = (roleName === '古月娜' ? '我是舞麟。' : '我是小凡。') + scenes[scene][0];
// Diagnostic only: replay one recorded provider draft through the production
// inspector, then permit a real correction. Never label it fresh generation.
const replay = [];
let restoredTurns=[];
if(scene==='identity-reentry-holdout'){
 if(draftSource||compactGuVoice||compactJudgmentEcho)throw Error('Fixed production reentry continuation only');
 const path=roleName==='古月娜'?'docs/GUYUENA-LIVE-CONTINUITY-RANGE-HOLDOUT-R2-2026-10-10.json':'docs/LUXUEQI-LIVE-CONTINUITY-RANGE-HOLDOUT-R1-2026-10-10.json';
 const source=JSON.parse(readFileSync(path,'utf8'));
 if(!source.complete||source.roleName!==roleName||source.rows.length!==12||source.rows[11].input!==scenes[scene][0]||source.rows.some(row=>row.failed||!row.replies?.length||row.calls?.some(call=>call.finish!=='stop'||call.replayed)))throw Error('Complete actual role-matched history required');
 restoredTurns=source.rows.slice(4,11);
}
if(['history-claim-carryover-transfer','implicit-history-carryover-transfer'].includes(scene)){
 if(roleName!=='古月娜'||draftSource||compactGuVoice||compactJudgmentEcho)throw Error('Fixed Gu history transfer only');
 const source=JSON.parse(readFileSync('docs/GUYUENA-LIVE-MIXED-AFFECTION-TRANSFER-R6-2026-10-10.json','utf8'));
 if(!source.complete||source.roleName!==roleName||source.rows[0].failed||source.rows[0].calls.length!==1||source.rows[0].calls[0].finish!=='stop')throw Error('Complete actual first turn required');
 restoredTurns=source.rows.slice(0,1);
}
if(draftSource) {
  if(!['shy-affection-transfer','spoiler-choice-transfer','everyday-transfer','ordinary-discovery-transfer','familiarity-knowledge-transfer','preference-dispute-transfer'].includes(scene) || !/^docs\/(?:GUYUENA|LUXUEQI)-LIVE-(?:SHY-AFFECTION|SPOILER-CHOICE|EVERYDAY|ORDINARY-DISCOVERY|FAMILIARITY-KNOWLEDGE|PREFERENCE-DISPUTE)-TRANSFER-R\d{1,2}-\d{4}-\d{2}-\d{2}\.json$/u.test(draftSource))throw Error('Expected a bounded saved transfer draft');
  const source=JSON.parse(readFileSync(draftSource,'utf8'));
  const row=source.rows?.[draftIndex];
  if(!source.complete || source.scene!==scene || source.roleName !== roleName || row?.input !== scenes[scene][draftIndex] || row.failed || row.calls?.length !== 1 || row.calls[0].replayed || row.calls[0].finish !== 'stop' || !row.calls[0].raw?.trim())throw Error('Replay requires a matching completed real draft');
  restoredTurns=source.rows.slice(0,draftIndex);
  if(restoredTurns.some((row,index)=>row.input!==scenes[scene][index]||row.failed||!row.replies?.length||row.calls?.some(call=>call.finish!=='stop'||call.replayed)))throw Error('Replay requires completed matching prior turns');
  replay.push({characterName:roleName,input:row.input,raw:row.calls[0].raw});
  scenes[scene]=[row.input];
}
const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const output = `docs/${roleName === '古月娜' ? 'GUYUENA' : 'LUXUEQI'}-LIVE-${scene.toUpperCase()}-${revision.toUpperCase()}-${day}.json`;
if (existsSync(output)) throw Error('Existing live evidence must not be overwritten');
// '-' accepts one line from a pipe; secrets never appear in process argv,
// generated files or logs. File mode uses the user-provided DeepSeek section.
let apiKey;
if (keyFile === '-') {
  apiKey = await new Promise((resolve, reject) => {
    let input = '';
    const onData = chunk => {
      input += chunk.toString();
      if (input.length > 256) { process.stdin.pause(); reject(Error('Oversized credential input')); return; }
      if (input.includes('\n')) {
        process.stdin.off('data', onData); process.stdin.pause();
        resolve(input.split(/\r?\n/u)[0].trim()); input = '';
      }
    };
    process.stdin.on('data', onData); process.stdin.resume();
    process.stdin.once('end', () => reject(Error('Credential pipe ended before a line was provided')));
  });
} else {
  let credentialText = readFileSync(keyFile, 'utf8');
  const credentialLines = credentialText.split(/\r?\n/u);
  const heading = credentialLines.findIndex(line => /deepseek/iu.test(line));
  const end = credentialLines.findIndex((line, index) => index > heading && /silicon|硅基|openai|anthropic|qwen/iu.test(line));
  const candidates = heading >= 0 ? credentialLines.slice(heading, end > heading ? end : credentialLines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu) ?? [] : [];
  apiKey = candidates[Number(keyOrdinal) - 1]; candidates.fill('');
  credentialText = ''; credentialLines.fill('');
}
if (!/^sk-[A-Za-z0-9_-]{16,}$/u.test(apiKey ?? '')) throw Error('No valid explicitly provided test credential');
const proxy = await startLiveTestProxy({ apiKey, maxCalls: scene==='casual-sidewalk-holdout'?2:['ordinary-detail-holdout','tiny-curiosity-holdout'].includes(scene)?4:scene==='identity-reentry-holdout'?2:scene==='continuity-range-holdout'?12:draftSource||['understated-joy-transfer','quiet-joy-transfer'].includes(scene) ? 2 : ['daily-dialogue-transfer','personality-range-transfer'].includes(scene)?8:['shy-affection-transfer','natural-missing-transfer','personal-view-transfer'].includes(scene)?3:['spoiler-choice-transfer','small-success-transfer','ordinary-discovery-transfer','lore-mention-transfer','familiarity-knowledge-transfer','small-choice-transfer'].includes(scene) ? 4 : transferScenes.has(scene) ? 6 : 12, maxTokens: 500 });
apiKey = undefined;
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const report = { date: new Date().toISOString(), scene, revision, model: 'deepseek-flash', scope: `${scenes[scene].length} fresh consecutive turns through actual private send service and IndexedDB; production generation settings and authored preset proactivity; summaries, extraction and settlement mocked; nonstream upstream; transport completion does not grade character fidelity or human-likeness.`, complete: false, rows: [], errors: [] };
report.guVoiceCompaction=compactGuVoice;
report.judgmentEchoCompaction=compactJudgmentEcho;
report.historyProvenance=historyProvenance;
report.historyQuarantine=historyQuarantine;
if(['history-claim-carryover-transfer','implicit-history-carryover-transfer'].includes(scene))report.scope+=' Fixed saved Gu R6 first turn is restored; two new continuations compare source representation, not freshly generated original histories.';
let browser, server;
report.roleName = roleName;
report.generationMode=generationMode;
if(generationMode==='direct')report.scope+=' Evaluation only: same production prompt and pipeline, provider thinking disabled, temperature .8; not the shipped generation settings.';
report.compactReact=compactReact;
if(compactReact)report.scope+=' Evaluation-only ordinary reaction directive shortening; no other turn instructions removed.';
if (roleName === '古月娜') report.scope = report.scope.replace('authored preset proactivity', 'fixed proactivity 0.5 (same as the Gu Yue Na scene runner)');
if(draftSource) {
  report.draftSource=draftSource;
  report.replayRowIndex=draftIndex;
  report.restoredPriorRows=restoredTurns.length;
  report.scope=report.scope.replace('1 fresh consecutive turns', 'one saved real draft replayed unpublished under the current persona, followed only if requested by the production inspector by a real correction; this is not fresh initial generation, not a fixed-persona comparison');
}
try {
  const bundle = await build({ entryPoints: ['scripts/verify/chat-human-live.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { LIVE_COMPACT_REACT_GUIDANCE:String(compactReact), LIVE_JUDGMENT_ECHO_COMPACT:String(compactJudgmentEcho), LIVE_GU_VOICE_COMPACT:String(compactGuVoice),LIVE_PROXY: JSON.stringify(proxy.url), LIVE_TOKEN: JSON.stringify(proxy.token), LIVE_RESPONSES: JSON.stringify(replay), LIVE_VOICE_EARLIER: 'false', LIVE_EMOTION_COMPACT: 'false', LIVE_GENERATION_MODE: JSON.stringify(generationMode), 'import.meta.env': '{"VITE_AI_GATEWAY_URL":""}', __APP_VERSION__: '"luxueqi-live"' } });
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/test.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><html><body><script src="/test.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => !!window.liveExpression);
  report.persona = await page.evaluate(name => window.liveExpression.presets(true).find(c => c.name === name), roleName);
  if (!report.persona) throw Error('Shipped persona unavailable');
  if (roleName === '陆雪琪' && typeof report.persona.proactivity !== 'number') throw Error('Authored proactivity missing');
  await page.evaluate(({persona,proactivity}) => window.liveExpression.setup(persona, proactivity), {persona:report.persona,proactivity:roleName === '古月娜' ? .5 : report.persona.proactivity});
  await page.evaluate(enabled=>window.liveExpression.enableHistoryProvenance(enabled),historyProvenance);
  if(historyReviewSnapshot)await page.evaluate(snapshot=>window.liveExpression.enableHistoryQuarantine(snapshot),historyReviewSnapshot);
  if(restoredTurns.length) {
    report.restoredMessageCount=await page.evaluate(rows=>window.liveExpression.restoreSavedTurns(rows),restoredTurns);
    report.scope+=' Prior actual delivered turns and conversation attention were restored only in the isolated DB with synthetic timestamps; this is not the original timed session.';
  }
  for (const input of scenes[scene]) {
    const row = await page.evaluate(text => window.liveExpression.turn(text), input);
    report.rows.push(row); writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ input, replies: row.replies, failed: row.failed, calls: row.calls.length }));
    if (row.failed || !row.replies.length || row.calls.at(-1)?.finish === 'length') break;
  }
  report.complete = report.rows.length === scenes[scene].length && !report.errors.length && !report.rows.some(row => row.failed || !row.replies.length);
} catch (error) {
  report.errors.push(error.message); process.exitCode = 1;
} finally {
  report.providerCalls = proxy.getObservations();
  report.usage = report.providerCalls.reduce((sum, call) => ({ calls: sum.calls + 1, input: sum.input + (call.usage?.prompt_tokens ?? 0), output: sum.output + (call.usage?.completion_tokens ?? 0), total: sum.total + (call.usage?.total_tokens ?? 0), missingUsage: sum.missingUsage + Number(!call.usage) }), { calls: 0, input: 0, output: 0, total: 0, missingUsage: 0 });
  writeFileSync(output, JSON.stringify(report, null, 2));
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await proxy.close();
}
console.log(JSON.stringify({ complete: report.complete, usage: report.usage, evidence: output }));
