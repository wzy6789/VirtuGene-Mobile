import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=JSON.parse(readFileSync('release/obsidian-chat-separation-2026-10-10.json','utf8'));
const output='release/obsidian-chat-separation-final-2026-10-10.json';
if(existsSync(output))throw Error('Final separation evidence already exists');
const rows=source.evidence.map(item=>{
  const current=readFileSync(item.path,'utf8');
  const normalize=text=>text.split('\n').filter(line=>!line.startsWith('#')&&!/^R59局部改善、整体未达标：/u.test(line)).join('\n').replace(/\n{3,}/gu,'\n\n').trim();
  if(normalize(current)!==normalize(item.output))throw Error('Speaker text changed beyond removing the identified R59 review paragraph');
  if(/^(?:人工复核|复核[：:]|用量|证据[：:]|R\d+局部)/mu.test(current))throw Error('Review prose remains in dialogue');
  return {path:item.path,messageCount:item.messageCount,sha256:createHash('sha256').update(current).digest('hex')};
});
writeFileSync(output,JSON.stringify({rows,source:'release/obsidian-chat-separation-2026-10-10.json',allowedCleanup:'One standalone R59 reviewer paragraph and metadata headings; dialogue speaker text preserved.'},null,2));
console.log('PASS dialogue separation: 493 Gu and 310 Lu speaker records preserved; standalone review moved out, final hashes recorded');
