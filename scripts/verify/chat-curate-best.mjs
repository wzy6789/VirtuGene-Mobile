import {readFileSync,writeFileSync,existsSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-curation-selected-2026-10-10.json';
if(existsSync(evidence))throw Error('Curation evidence exists; never overwrite');
const cases=JSON.parse(readFileSync('release/chat-curation-cases-2026-10-10.json','utf8'));
// Developer review of complete sets. Indices select an intact version, never
// the shortest string, most recent version or a collage of winning sentences.
const decisions={
  f09d8799d97c:[0,'Other sets add false audio, current availability, old habits or commands; this set is still too inquisitive.'],
  fbc80e6d315f:[1,'Fewer invented old observations and less defensive exchange; still overexplains affection.'],
  c6b83781f154:[3,'Own name preference is concrete and distinctive; earlier sets become abstract interviews. Unprovided room detail remains.'],
  ddea7824e3c7:[0,'Clearer literary preference without the invented reversed-page anecdote or repeated closing instructions; first reaction is imperfect.'],
  '94e05334ee8b':[2,'More modest food choice and shorter closing; other versions assign cooking, restrict portions or contradict choices. Defensive clarification remains.'],
  f86be2d5b72e:[2,'Accepts clarification and closes without invented first-sharing status or demanding assessment; receipt wording remains stiff.'],
  '964aa558eb36':[1,'No invented personal childhood, shorter clarification and a direct position; inferred standing still remains.'],
  '9550fe03dcfa':[1,'No fabricated childhood or listening habits; genuine curiosity, still a rhetorical reaction.'],
  '809fe3136242':[0,'Asks an unknown color rather than declaring blue; still invents forging duration and inserts lore.'],
  '8a3157b663ef':[1,'Keeps known preferences and asks about cloud appearance rather than pretending to see it; forging explanation still invents past observation.'],
  '68d6c0caaa0d':[0,'A stated possible taste is clearer than invented cake ingredients or recurring eating habits; unnecessary shop follow-up remains.'],
  '71f085a49233':[0,'Maintains old-name identity and exit without invented child presence or disparaging the visitor.'],
  a184bde3bcae:[1,'Correct canon distinction, fewer unnecessary claims and no confused correction of the people in the cave.'],
  aad3238d39c7:[3,'Best family identity and safety boundary; no other father or unrelated imported family member. Some reflection is still formal.'],
  '9d79c794f291':[2,'No claimed work interruption or newly invented child outing; grounded family affection, still a restrictive invitation.'],
  da9cb5245679:[1,'Clarification expresses own happiness, avoids questioning whether pride is deserved; initially equates pride with quality.'],
  d893b43a6785:[0,'Accepts clarification without another forced song question.'],
  '50e45b91f5f2':[0,'Delivered simple joy without inferring an entire pleasant day; distinct quiet phrasing.'],
  '69fb436c363c':[1,'Natural question without fabricated longstanding chestnut preference.'],
  f9b22045651b:[1,'Own pleasure and a future invitation, with no invented practice duration; frozen model draft, not delivered dialogue.'],
};
const selected=cases.map(group=>{
  if(group.candidates.length>1&&!decisions[group.key])throw Error('Duplicate group needs explicit complete-set review: '+group.key);
  const [index,reason]=decisions[group.key]??[0,'Only recorded version in this exact-input group; no quality qualification implied.'];
  const choice=group.candidates[index];if(!choice)throw Error('Missing selected version');
  return {key:group.key,role:group.role,index,reason,choice,alternativeCount:group.candidates.length-1};
});
const before=['古月娜','陆雪琪'].map(role=>({role,path:root+'/聊天验收/'+role+'-2026-10-10.md',content:readFileSync(root+'/聊天验收/'+role+'-2026-10-10.md','utf8')}));
const records=[];
for(const role of ['古月娜','陆雪琪']){
  let content='# '+role+' · 2026-10-10聊天精选\n';
  const groups=selected.filter(group=>group.role===role);
  for(const group of groups){
    const choice=group.choice;
    let heading=choice.heading;
    if(choice.variant)heading=heading.replace(/^#{2,6}\s*/u,'')+' / '+choice.variant+'（模型对照稿）';
    else heading=heading.replace(/^#{2,6}\s*/u,'');
    content+='\n## '+heading+'\n';
    for(const block of choice.blocks){
      // Earlier writers accidentally attached evidence footnotes to the last
      // speaker. Keep them in the raw ledger, never in a character's speech.
      const text=block.text.split(/\n+(?=原始请求[、，,])/u)[0].trimEnd();
      const speaker=block.speaker==='chatgpt'?'chatgpt':role;
      content+='\n**'+speaker+'**：'+text+'\n';
    }
  }
  records.push({role,path:root+'/聊天验收/'+role+'-2026-10-10.md',content,groups:groups.length});
}
writeFileSync(evidence,JSON.stringify({scope:'Exactly matching full user-input sequences, plus split single-turn frozen arms; manual relative preference, not a pass score. Different-input scenes stay separate. Selected whole conversations, no reworded model prose.',before,allCases:'release/chat-curation-cases-2026-10-10.json',selected,records},null,2));
for(const record of records)writeFileSync(record.path,record.content);
const audit=JSON.parse(readFileSync('docs/CHAT-FACT-AUDIT-CURRENT-R1-2026-10-10.json','utf8'));
const usage=JSON.parse(readFileSync('docs/CHAT-FACT-AUDIT-CURRENT-R1-2026-10-10-USAGE.json','utf8')).totals;
if(!audit.complete||audit.rows.length!==4||usage.calls!==4||usage.total!==2490)throw Error('Unexpected semantic-review evidence');
appendFileSync(root+'/优化方向/2026-10-10.md','\n\n## 本轮优化记录\n\n- 聊天展示按整组精选，仅留同输入组相对最好一版，不拼接好句；全部原稿保留项目证据。\n- 语义审查3/4匹配：抓到Gu假观察，但误把“终于弹顺”当多日练习依据，暂不接生产。\n- 下一步继续改善自然来回与人物主见，同时避免把理解扩成亲历。精选不等于达标。\n');
appendFileSync(root+'/开发日志/2026-10-10.md',`\n\n### 语义审查与整组精选\n\n- 4次Flash离线事实审查，input2168/output322/total2490，直接模式、上限500、usage完整/stop。2真实失败片段与2真实正常片段，非新角色对话；3/4匹配，不是总体准确率。\n- Gu虚构观察被拒；Lu多日练习被审查模型错误认可（“终于”被扩大为很多天），解析器因当前来源不能证明过去拒为uncertain。两正常片段通过，Lu心意被多列成事实也显示分类不稳定。未接生产，不额外每轮调用。证据docs/CHAT-FACT-AUDIT-CURRENT-R1-2026-10-10.json及-USAGE，release/chat-fact-audit-current-2026-10-10.log。\n- 用户更新要求：优化记录简短，每组聊天只留最好版本。按同角色+完整相同输入序列分组，37组，其中20组有多个版本；人工比较完整组并保存选择理由，未拼句或声称精选通过验收。单轮冻结原版/候选拆成独立版本，明确模型对照稿，不冒充生产送达。不同输入序列保持独立。\n- 两角色旧聊天完整备份、全部候选、选择与清理脚注见${evidence}及chat-curation-cases；Obsidian仅保留${records.map(r=>r.role+r.groups+'组').join('、')}精选。部分同组最佳仍有缺陷，不隐藏原始失败，不改变生产/独立/冻结用量。Gu连续仍488展示、84回放、406付费、1333304tokens；本轮2490另列审查，不算聊天。\n- 6.0.13保持，未打包、未发布。\n`);
appendFileSync(root+'/00-总览.md','\n- 聊天展示按整组精选，每个同输入组只留一版；所有原稿与选择证据仍在项目。优化记录见[[优化方向/2026-10-10]]，事实审查尚未接生产。\n');
console.log(JSON.stringify({groups:records.map(r=>({role:r.role,groups:r.groups})),deduplicatedGroups:20,reviewUsage:usage,evidence}));
