import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { updateSettingsSearchIndex } from '../settings-search-index.mjs';

let checks=0;
const failures=[];
const check=(condition,label)=>{if(!condition)failures.push(label);checks++;};
const folder='src/styles';
const modules=/vg-(living|world|moment|todo|stage|canvas|beat|suggestions|story|compass)|scene-stat/;
for(const file of readdirSync(folder).filter(file=>file.endsWith('.css'))){
  const tree=postcss.parse(readFileSync(join(folder,file),'utf8'));
  tree.walkRules(rule=>{
    if(modules.test(rule.selector))rule.walkDecls('font-size',decl=>{
      if(/^\d+(?:\.\d+)?px$/.test(decl.value))check(parseFloat(decl.value)>=12,`${file}: ${rule.selector} caption floor`);
    });
    rule.walkDecls(decl=>{if(['--bg','--bg-panel','--text','--text-secondary','--vg-accent','--vg-edge','--vg-ease','--aurora-a','--aurora-b','--aurora-c','--vg-statusbar'].includes(decl.prop))check(file==='theme-tokens.css',`${file}: palette belongs to shared root tokens`);});
    if(file==='todo-ui.css'&&rule.selector==='.vg-todo-save'){
      const colors=rule.nodes.filter(node=>node.type==='decl'&&node.prop==='color');
      check(colors.length===1&&colors[0].value==='var(--vg-on-action)','Todo save has exactly one action foreground declaration');
    }
    if(rule.selector.includes('vg-message-bubble'))rule.walkDecls('font-size',decl=>{
      check(file==='chat-bubbles.css'&&!decl.important,'bubble font has one component owner and respects user size');
    });
    if(file==='todo-ui.css'||file==='chat-bubbles.css')rule.walkDecls(decl=>{
      if(['color','background-color'].includes(decl.prop))check(!/#[0-9a-f]{3,8}\b/i.test(decl.value),`${file}: reading colors consume palette roles`);
    });
  });
}
// Reading roles must work on every supported opaque surface, not just white panels.
const palette=postcss.parse(readFileSync(join(folder,'theme-tokens.css'),'utf8'));
const luminance=hex=>{
  const channels=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];
};
palette.walkRules(rule=>{
  if(![':root',':root.dark'].includes(rule.selector))return;
  const roles=Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
  for(const surface of ['--bg-panel','--bg-surface','--bg-surface-strong']){
    for(const role of ['--text-secondary','--vg-cyan']){
      const fg=luminance(roles[role]),bg=luminance(roles[surface]);
      check((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)>=4.5,`${rule.selector}: ${role} reading text contrasts with ${surface}`);
    }
  }
});
const indexed=updateSettingsSearchIndex();
const registry=readFileSync('src/components/settings/settings-directory.ts','utf8');
const pages=[...registry.matchAll(/^  (\w+): /gm)].map(match=>match[1]).filter(page=>page!=='home');
for(const page of pages)check(!!indexed[page],`settings labels indexed for ${page}`);
check(indexed.voice.includes('朗读语速'),'component option labels are indexed automatically');
check(readFileSync('src/components/ui/MobileTabSwipe.tsx','utf8').includes('MOBILE_TABS.map'),'swipe order derives from the navigation registry');
for(const path of ['src/components/todo/TodoPage.tsx','src/components/moments/MomentsPage.tsx']){
  check(!readFileSync(path,'utf8').includes('sheet-backdrop'),'migrated sheets use the shared Modal');
}
assert.equal(failures.length,0,failures.join('\n'));
console.log(`PASS ${checks} design token and search-index checks`);
