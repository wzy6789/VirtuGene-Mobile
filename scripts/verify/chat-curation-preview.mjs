import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='D:/月起云归/VirtuGene/手机版/聊天验收/';
const roles=['古月娜','陆雪琪'];
const records=[];
for(const role of roles){
  const path=root+role+'-2026-10-10.md';const text=readFileSync(path,'utf8');
  const groups=text.split(/(?=^#{2,6} )/mu).filter(section=>section.includes('**chatgpt**：'));
  for(const group of groups){
    const heading=group.split('\n')[0];
    const blocks=[...group.matchAll(/^\*\*([^*]+)\*\*：[\s\S]*?(?=^\*\*[^*]+\*\*：|$(?![\s\S]))/gmu)].map(match=>({speaker:match[1],text:match[0].replace(/^\*\*[^*]+\*\*：/u,'').trim()}));
    const inputs=blocks.filter(block=>block.speaker==='chatgpt').map(block=>block.text);
    const variants=new Set(blocks.filter(block=>block.speaker!=='chatgpt').map(block=>block.speaker.match(/（([^）]+)）/u)?.[1]).filter(Boolean));
    if(variants.size>=2&&inputs.length>=2&&new Set(inputs).size===1){
      for(const variant of variants){
        const selected=[];for(let i=0;i<blocks.length;i++)if(blocks[i].speaker===role+'（'+variant+'）'){if(blocks[i-1]?.speaker==='chatgpt')selected.push(blocks[i-1]);selected.push(blocks[i]);}
        records.push({role,path,heading,variant,blocks:selected,inputs:[inputs[0]]});
      }
    }else records.push({role,path,heading,blocks,inputs});
  }
}
const byKey=new Map();
for(const record of records){
  const key=createHash('sha256').update(record.role+'\n'+JSON.stringify(record.inputs)).digest('hex').slice(0,12);
  const list=byKey.get(key)??[];list.push(record);byKey.set(key,list);
}
const cases=[...byKey].map(([key,candidates])=>({key,role:candidates[0].role,candidates}));
writeFileSync('release/chat-curation-cases-2026-10-10.json',JSON.stringify(cases,null,2));
console.log(JSON.stringify(cases.filter(c=>c.candidates.length>1).map(c=>({key:c.key,role:c.role,choices:c.candidates.map(x=>({heading:x.heading,variant:x.variant,first:x.blocks.find(b=>b.speaker!=='chatgpt')?.text,last:x.blocks.at(-1)?.text}))})),null,2));
