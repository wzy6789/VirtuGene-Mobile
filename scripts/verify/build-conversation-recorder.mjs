import { build } from 'esbuild';
import { readFileSync,writeFileSync } from 'node:fs';
const result=await build({entryPoints:['docs/prototypes/conversation-recorder.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'true'}});
const css=['src/styles/theme-tokens.css','src/styles/soul-orb.css','src/styles/chat-bubbles.css','docs/prototypes/conversation-recorder.css'].map(file=>readFileSync(file,'utf8')).join('\n');
const fonts=readFileSync('src/styles/ui-fonts.css','utf8');
const match=fonts.match(/url\(['"]?([^)'" ]*noto-sans-sc-ui\.woff2)['"]?\)/);
let font='';
if(match){const file=new URL(match[1],new URL('../../src/styles/ui-fonts.css',import.meta.url));font=`@font-face{font-family:VG Sans;src:url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format('woff2');font-weight:100 900;font-display:swap;}`;}
writeFileSync('docs/prototypes/conversation-recorder.html',`<!doctype html><html lang="zh-CN" class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小星 · 对话记录者设计预览</title><style>${css}\n${font}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`);
console.log('Built standalone docs/prototypes/conversation-recorder.html (sample data only)');
