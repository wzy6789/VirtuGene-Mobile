import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = resolve('.'), evidence = join(root, '.tmp-preview/chat-atmosphere-tokens-20261014');
await mkdir(evidence, { recursive:true });
const moduleFile = join(evidence, 'tokens.mjs');
await build({entryPoints:[join(root,'src/lib/chat-atmosphere.ts')],outfile:moduleFile,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {CHAT_ATMOSPHERE_THEMES,resolveCharacterAtmosphere,getChatAtmosphereVariables,isChatAtmosphereThemeId} = await import(pathToFileURL(moduleFile).href);
const checks = [], contrastSamples = [];
const check = (name,pass,detail) => { checks.push({name,pass:!!pass,...(detail===undefined?{}:{detail})}); if (!pass) console.error(`FAIL ${name}`,detail ?? ''); };
const rgb = color => color.match(/^#([0-9a-f]{6})$/i)?.[1].match(/../g).map(hex=>parseInt(hex,16)/255);
const luminance = color => {
  const c = rgb(color); if (!c) throw new Error(`Not opaque hex: ${color}`);
  return c.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
};
const contrast = (a,b) => { const [x,y]=[luminance(a),luminance(b)].sort((x,y)=>y-x); return (x+.05)/(y+.05); };
const highlightSurface = (base,highlight) => {
  const [r,g,b,alpha]=highlight.match(/[\d.]+/g).map(Number);
  return '#'+rgb(base).map((channel,i)=>Math.round(channel*255*(1-alpha)+[r,g,b][i]*alpha).toString(16).padStart(2,'0')).join('');
};
for (const theme of CHAT_ATMOSPHERE_THEMES) {
  check(`${theme.id}: registered stable id`,isChatAtmosphereThemeId(theme.id));
  check(`${theme.id}: slow background period`,theme.motion.periodMs>=12000&&theme.motion.periodMs<=20000,theme.motion.periodMs);
  for (const mode of ['light','dark']) {
    const palette=theme[mode];
    for (const surface of ['bg','panel','surface','surfaceStrong','ai']) {
      for (const content of ['text','sub','accent','cyan']) {
        const ratio=contrast(palette[content],palette[surface]);
        contrastSamples.push({theme:theme.id,mode,content,surface,ratio});
        check(`${theme.id}/${mode}: ${content} on ${surface} ≥4.5`,ratio>=4.5,Number(ratio.toFixed(3)));
      }
    }
    for (const surface of ['action','user']) {
      const ratio=contrast('#ffffff',palette[surface]);
      contrastSamples.push({theme:theme.id,mode,content:'white',surface,ratio});
      check(`${theme.id}/${mode}: white on ${surface} ≥4.5`,ratio>=4.5,Number(ratio.toFixed(3)));
    }
    for(const surface of ['ai','surface']) {
      const tinted=highlightSurface(palette[surface],palette.highlight);
      for(const content of ['text','sub','accent','cyan']) {
        const ratio=contrast(palette[content],tinted);
        contrastSamples.push({theme:theme.id,mode,content,surface:`${surface}+highlight`,ratio});
        check(`${theme.id}/${mode}: ${content} on ${surface} maximum highlight ≥4.5`,ratio>=4.5,Number(ratio.toFixed(3)));
      }
    }
    const variables=getChatAtmosphereVariables(theme.id);
    check(`${theme.id}/${mode}: palette variables present`,variables[`--chat-${mode}-ai`]===palette.ai&&variables[`--chat-${mode}-text`]===palette.text);
  }
}
const fixtures = [
  ['undefined is neutral',undefined,{primary:'neutral',source:'neutral'}],
  ['names and identity lore do not infer traits',{name:'高冷的神秘人',systemPrompt:'身份：神秘王国的人。\n对话样本：今天温柔一点。'},{primary:'neutral',source:'neutral'}],
  ['unknown tags remain neutral',{tags:['旅行','学生']},{primary:'neutral',source:'neutral'}],
  ['cool authored tags',{tags:['清冷','克制']},{primary:'cool',source:'character'}],
  ['warm authored personality',{personality:'温柔，亲近而体贴'},{primary:'warm',source:'character'}],
  ['lively explicit section',{systemPrompt:'性格：活泼开朗，喜欢开玩笑。'},{primary:'lively',source:'character'}],
  ['calm explicit section',{systemPrompt:'- 性格：理性严谨，以逻辑推敲。'},{primary:'calm',source:'character'}],
  ['steady authored tags',{tags:['稳重','可靠']},{primary:'steady',source:'character'}],
  ['mysterious authored tags',{tags:['神秘','疏离']},{primary:'mysterious',source:'character'}],
  ['negative personality does not count',{systemPrompt:'性格：并非温柔，也不是活泼的人。'},{primary:'neutral',source:'neutral'}],
  ['secondary kept to one meaningful tendency',{tags:['温柔','细腻','稳重']},{primary:'warm',secondary:'steady',source:'character'}],
  ['secretary has authored mapping',{secretaryPersonality:'professional'},{primary:'calm',source:'character'}],
  ['balanced does not force a personality color',{secretaryPersonality:'balanced'},{primary:'neutral',source:'neutral'}],
];
for(const [name,input,expected] of fixtures) check(name,JSON.stringify(resolveCharacterAtmosphere(input))===JSON.stringify(expected),{actual:resolveCharacterAtmosphere(input),expected});
const primary=getChatAtmosphereVariables('cool'),paired=getChatAtmosphereVariables('cool','warm');
check('secondary influences edge light only',Object.entries(paired).filter(([key,value])=>primary[key]!==value).every(([key])=>key.endsWith('-glow-secondary')));
check('unknown persisted theme can be rejected',!isChatAtmosphereThemeId('custom-unsafe')&&!isChatAtmosphereThemeId(null));
const result={passed:checks.every(check=>check.pass),checks,contrastSamples,sourceHash:createHash('sha256').update(await readFile(join(root,'src/lib/chat-atmosphere.ts'))).digest('hex'),modelCalls:0,microphoneCalls:0,nativeDeviceTest:false};
await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:result.passed,checks:checks.length,failed:checks.filter(check=>!check.pass).length,minContrast:Math.min(...contrastSamples.map(sample=>sample.ratio)),evidence},null,2));
if (!result.passed) process.exitCode=1;
