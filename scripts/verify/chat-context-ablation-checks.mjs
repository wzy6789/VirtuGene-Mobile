import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ablateOwnedGuidance } from './chat-context-ablation-live.mjs';

const sample = '[VirtuGene · 古月娜的关心]\n判断习惯：自己的判断。\n亲密反应：完整的亲密反应。\n当前事实：孩子是谁。\n[/VirtuGene · 古月娜的关心]\n[人物声音卡]\n人物判断依据：判断习惯：自己的判断。\n[/人物声音卡]';
const result = ablateOwnedGuidance(sample, '古月娜', 'duplicate-fields-only');
assert(!result.slice(0, result.indexOf('[人物声音卡]')).includes('判断习惯：自己的判断。'));
assert(result.includes('亲密反应：完整的亲密反应。') && result.includes('当前事实：孩子是谁。'));
assert(result.slice(result.indexOf('[人物声音卡]')) === sample.slice(sample.indexOf('[人物声音卡]')));
const partial = sample.replace('人物判断依据：判断习惯：自己的判断。', '人物判断依据：判断习惯：自己的');
assert(ablateOwnedGuidance(partial, '古月娜', 'duplicate-fields-only') === partial);
const lu = sample.replaceAll('古月娜', '陆雪琪');
assert(ablateOwnedGuidance(lu, '陆雪琪', 'duplicate-fields-only').includes('当前事实：孩子是谁。'));
assert.throws(() => ablateOwnedGuidance(sample, '别的角色', 'duplicate-fields-only'));
assert.throws(() => ablateOwnedGuidance(sample.replace('[/人物声音卡]', ''), '古月娜', 'duplicate-fields-only'));
const source = JSON.parse(readFileSync('docs/CHAT-FLASH-SCENE-5-GUYUENA-EVERYDAY-HELDOUT-R1-2026-10-10.json', 'utf8'));
for (const row of source.rows) {
  const original = row.calls[0].messages[0].content;
  const reduced = ablateOwnedGuidance(original, '古月娜', 'duplicate-fields-only');
  assert(reduced.endsWith(original.slice(original.indexOf('[人物声音卡]'))));
  assert(reduced.includes('蓝轩宇是孩子') && reduced.includes('舞麟喜欢锻造'));
}
console.log('PASS context-ablation: duplicate-only boundaries and six actual source requests; zero model calls');

const prideSource = JSON.parse(readFileSync('docs/GUYUENA-LIVE-SMALL-SUCCESS-TRANSFER-R1-2026-10-10.json', 'utf8'));
const prideSystem = prideSource.rows[0].calls[0].messages[0].content;
const agencySystem = ablateOwnedGuidance(prideSystem, '古月娜', 'agency-framing');
const ownedStart = prideSystem.indexOf('[VirtuGene · 古月娜的关心]');
const ownedEnd = prideSystem.indexOf('[/VirtuGene · 古月娜的关心]');
const cardStart = prideSystem.lastIndexOf('[人物声音卡]');
const cardEnd = prideSystem.indexOf('[/人物声音卡]', cardStart);
assert(agencySystem.slice(0, ownedStart) === prideSystem.slice(0, ownedStart));
assert(agencySystem.includes(prideSystem.slice(ownedEnd, cardStart)));
assert(agencySystem.endsWith(prideSystem.slice(cardEnd)));
assert(agencySystem.includes('对外仍有银龙王的清醒与骄傲'));
assert(agencySystem.includes('你清楚自己的好恶和选择') && !agencySystem.includes('骄傲落在自己的选择上'));
assert.throws(() => ablateOwnedGuidance(prideSystem, '陆雪琪', 'agency-framing'));
assert.throws(() => ablateOwnedGuidance(prideSystem.replaceAll('你的骄傲在自己的选择里，愿意说什么就说清楚。', '用户自写内容'), '古月娜', 'agency-framing'));
assert(prideSource.rows[0].calls[0].messages[1].content.includes('我是舞麟'));
console.log('PASS agency-framing: actual source boundaries, outsider pride and unrelated content preserved; Lu and modified sources rejected');

for(const role of ['GUYUENA','LUXUEQI']) {
 const report=JSON.parse(readFileSync('docs/'+role+'-LIVE-ORDINARY-DISCOVERY-TRANSFER-R1-2026-10-10.json','utf8'));
 const original=report.rows[1].calls[0].messages[0].content;
 const changed=ablateOwnedGuidance(original,report.roleName,'clarification-framing');
 assert(changed.startsWith(original.slice(0,original.indexOf('[本轮交流的隐藏节奏]'))));
 assert(changed.endsWith(original.slice(original.lastIndexOf('[人物声音卡]'))));
 assert(changed.includes('补充范围本身不证明你说错了')&&!changed.includes('用户在更正刚才的说法，接最新内容即可'));
 assert.throws(()=>ablateOwnedGuidance(original.replace('自己的误解直接改过来','未知自写指导'),report.roleName,'clarification-framing'));
 const first=report.rows[0].calls[0].messages[0].content;
 const brief=ablateOwnedGuidance(first,report.roleName,'reaction-brief');
 assert(brief.startsWith(first.slice(0,first.indexOf('[本轮交流的隐藏节奏]'))));
 assert(brief.endsWith(first.slice(first.lastIndexOf('[人物声音卡]'))));
 assert(brief.includes('自己的往事、生活习惯和身体感受须有人设或独立生活记录支持'));
 assert(brief.length<first.length && !brief.includes('不必用“我以前也这样”'));
 assert.throws(()=>ablateOwnedGuidance(original,report.roleName,'reaction-brief'));
}
console.log('PASS clarification-framing and reaction-brief: exact owned directions only; both actual role histories, canon and voice cards preserved');

const joyEvidence=JSON.parse(readFileSync('docs/LUXUEQI-LIVE-UNDERSTATED-JOY-TRANSFER-R1-2026-10-10.json','utf8'));
const joySystem=joyEvidence.rows[0].calls[0].messages[0].content;
const sharedJoy=ablateOwnedGuidance(joySystem,'陆雪琪','shared-joy-framing');
const oldJoy='庆祝反应：为眼前的好消息高兴，认真认可那件事，不补一段用户此前受苦的经历。';
const newJoy='庆祝反应：亲近的人愿意告诉你一件高兴的小事，你也会觉得有趣或高兴，平常地说自己的反应。';
assert(sharedJoy.replaceAll(newJoy,oldJoy)===joySystem);
assert.throws(()=>ablateOwnedGuidance(joySystem,'古月娜','shared-joy-framing'));
assert.throws(()=>ablateOwnedGuidance(joySystem.replace(oldJoy,'庆祝反应：用户自己的改写。'),'陆雪琪','shared-joy-framing'));
const tailStyle=ablateOwnedGuidance(joySystem,'陆雪琪','voice-style-tail');
const styleLine=tailStyle.split('\n').find(line=>line.startsWith('人物说话习惯（沿用原人设）：'));
assert(styleLine&&tailStyle.replace(styleLine+'\n','')===joySystem);
console.log('PASS shared-joy and voice-style diagnostics: exact fields only, unchanged facts and history, modified sources rejected');

for(const file of ['GUYUENA-LIVE-SMALL-CHOICE-TRANSFER-R1-2026-10-10.json','LUXUEQI-LIVE-QUIET-JOY-TRANSFER-R1-2026-10-10.json']) {
  const evidence=JSON.parse(readFileSync('docs/'+file,'utf8'));
  const sourceSystem=evidence.rows[file.startsWith('GUYUENA')?1:0].calls[0].messages[0].content;
  const reduced=ablateOwnedGuidance(sourceSystem,evidence.roleName,'focused-reactions');
  const tailStart=sourceSystem.lastIndexOf('[人物声音卡]');
  assert(reduced.endsWith(sourceSystem.slice(tailStart)));
  const removed=sourceSystem.slice(0,tailStart).split('\n').filter(line=>!reduced.split('\n').includes(line));
  assert(removed.length>0&&removed.every(line=>/^(?:被夸反应|分歧反应|道歉修复|亲密反应|疲惫回应|庆祝反应)[：:]/u.test(line)));
  for(const line of sourceSystem.split('\n').filter(line=>line.startsWith('庆祝反应：')&&sourceSystem.slice(tailStart).includes(line)))assert(reduced.includes(line));
}
console.log('PASS focused-reactions diagnostic: only inactive reaction fields removed, active voice and all other context preserved');
