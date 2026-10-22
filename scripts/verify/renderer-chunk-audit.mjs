import { build } from 'vite';
import fs from 'node:fs';
import {gzipSync} from 'node:zlib';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]||'before';
const out='.tmp-preview/ui-overhaul-20261016/startup-chunks/'+phase;fs.mkdirSync(out,{recursive:true});
await build({logLevel:'error',plugins:[{name:'verify-renderer-chunk-audit',generateBundle(_options,bundle){
 const chunks=Object.values(bundle).filter(x=>x.type==='chunk').map(chunk=>({file:chunk.fileName,entry:chunk.isEntry,imports:chunk.imports,dynamicImports:chunk.dynamicImports,bytes:Buffer.byteLength(chunk.code),gzip:gzipSync(chunk.code).length,modules:Object.entries(chunk.modules).map(([id,m])=>({id,bytes:m.renderedLength})).sort((a,b)=>b.bytes-a.bytes)}));
 const byName=new Map(chunks.map(c=>[c.file,c])),initial=new Set();const visit=name=>{if(initial.has(name))return;initial.add(name);byName.get(name)?.imports.forEach(visit);};chunks.filter(c=>c.entry).forEach(c=>visit(c.file));
 const report={phase,recordedAt:new Date().toISOString(),scope:'Build static import graph and gzip; not browser transfer timing or Android parsing.',chunks,initialFiles:[...initial],initialJsGzip:[...initial].reduce((n,f)=>n+(byName.get(f)?.gzip??0),0)};
 fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({entry:chunks.find(c=>c.entry)?.file,initialJsGzip:report.initialJsGzip,initialFiles:report.initialFiles,topEntry:chunks.find(c=>c.entry)?.modules.slice(0,22)}));
 }}]});
// Vite can append preload helpers in a later generateBundle hook. Measure the
// written files rather than treating the earlier hook's code as final bytes.
const report=JSON.parse(fs.readFileSync(out+'/result.json','utf8'));
report.generatedBeforeFinalization={initialJsGzip:report.initialJsGzip,entryGzip:report.chunks.find(c=>c.entry)?.gzip};
report.prunedCssOnlyChunks=report.chunks.filter(c=>!fs.existsSync('dist/renderer/'+c.file));
for(const chunk of report.prunedCssOnlyChunks){if(chunk.modules.some(m=>!m.id.endsWith('.css')))throw new Error('Missing final JavaScript file: '+chunk.file);}
report.chunks=report.chunks.filter(c=>fs.existsSync('dist/renderer/'+c.file));
for(const chunk of report.chunks){const data=fs.readFileSync('dist/renderer/'+chunk.file);chunk.bytes=data.length;chunk.gzip=gzipSync(data).length;}
const byName=new Map(report.chunks.map(c=>[c.file,c]));report.initialJsGzip=report.initialFiles.reduce((n,f)=>n+(byName.get(f)?.gzip??0),0);report.scope='Final files on disk plus static import graph; gzip is locally computed, not actual network compression, device parse time or frame performance.';
fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({finalEntryGzip:report.chunks.find(c=>c.entry)?.gzip,finalInitialJsGzip:report.initialJsGzip}));
