import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=walk('src/styles').filter(f=>f.endsWith('.css'));
const sources=walk('src').filter(f=>/\.(tsx?|jsx?)$/.test(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
const parsed=files.map(file=>({file,root:postcss.parse(fs.readFileSync(file,'utf8'))}));
const references=parsed.map(({root})=>{const clone=root.clone();clone.walkAtRules(/keyframes$/,rule=>rule.remove());return clone.toString();}).join('\n')+sources;
const removed=[];
for(const {file,root} of parsed){
  const before=root.toString();
  root.walkAtRules(/keyframes$/,rule=>{if(!references.includes(rule.params)){removed.push({file,name:rule.params,line:rule.source.start.line});rule.remove();}});
  root.walkAtRules(rule=>{if(rule.nodes?.length===0)rule.remove();});
  const after=root.toString();
  if(before!==after&&process.argv.includes('--apply')){
    const backup=path.join('.tmp-preview/ui-overhaul-20261015/css-keyframes-before',file);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,before);fs.writeFileSync(file,after);
  }
}
fs.writeFileSync('.tmp-preview/ui-overhaul-20261015/obsolete-keyframes-audit.json',JSON.stringify({applied:process.argv.includes('--apply'),removed},null,2));
console.log(JSON.stringify(removed));
