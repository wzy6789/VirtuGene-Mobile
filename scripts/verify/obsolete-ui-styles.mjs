import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
const source = walk('src').filter(f=>/\.(tsx?|jsx?)$/.test(f)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
// Dynamic prefixes (e.g. `vg-${...}`) are handled conservatively: only known
// component families with a meaningful prefix can protect an unused selector.
const prefixes = [...source.matchAll(/(vg-[a-z0-9-]{3,})\$\{/g)].map(m=>m[1]);
const reusable = new Set(['vg-layer-sheet','vg-layer-viewer','vg-display-number']);
const missing = name => name.startsWith('vg-') && !reusable.has(name) && !source.includes(name) && !prefixes.some(p=>name.startsWith(p));
const changes = [];
for (const file of walk('src/styles').filter(f=>f.endsWith('.css'))) {
  const before = fs.readFileSync(file,'utf8'), root = postcss.parse(before);
  const removed = [];
  root.walkRules(rule => {
    if (!rule.selector.includes('.vg-')) return;
    let tree; try {tree = selectorParser().astSync(rule.selector);} catch { return; }
    for (const selector of [...tree.nodes]) {
      // Classes nested inside :is/:not/:has are not proof that a rule is dead.
      const dead = selector.nodes.filter(n=>n.type==='class' && missing(n.value)).map(n=>n.value);
      if (/^(globals|mobile-refinement)\.css$/.test(path.basename(file)) && selector.nodes.some(n=>n.type==='class'&&n.value==='vg-navigation')) dead.push('navigation superseded by mobile-soul.css');
      if (dead.length) { removed.push({selector:selector.toString(),dead,line:rule.source.start.line}); selector.remove(); }
    }
    if (!tree.nodes.length) rule.remove(); else rule.selector=tree.toString();
  });
  if (!removed.length) continue;
  const after = root.toString();
  changes.push({file,bytesRemoved:Buffer.byteLength(before)-Buffer.byteLength(after),removed});
  if (process.argv.includes('--apply')) {
    const backup=path.join('.tmp-preview/ui-overhaul-20261015/css-cleanup-before',file); fs.mkdirSync(path.dirname(backup),{recursive:true});
    if(!fs.existsSync(backup))fs.writeFileSync(backup,before);
    fs.writeFileSync(file,after);
  }
}
fs.mkdirSync('.tmp-preview/ui-overhaul-20261015',{recursive:true});
fs.writeFileSync('.tmp-preview/ui-overhaul-20261015/obsolete-css-audit.json',JSON.stringify({mode:process.argv.includes('--apply')?'applied':'audit',prefixes,changes},null,2));
console.log(JSON.stringify(changes.map(({file,bytesRemoved,removed})=>({file,bytesRemoved,rules:removed.length,classes:[...new Set(removed.flatMap(r=>r.dead))]})),null,2));
