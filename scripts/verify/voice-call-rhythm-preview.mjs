import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
const dir='.tmp-preview/voice-call-rhythm-20261013';const serve=process.argv.includes('--serve');
const portIndex=process.argv.indexOf('--port');
const previewPort=portIndex<0?4193:Number(process.argv[portIndex+1]);
if(!Number.isInteger(previewPort)||previewPort<1024||previewPort>65535)throw Error('Invalid local preview port');
const css=readdirSync('dist/renderer/assets').filter(f=>f.endsWith('.css')).map(f=>readFileSync('dist/renderer/assets/'+f,'utf8')).join('\n');
const sourcePrefix=resolve('src')+'\\';
async function bundle(before){return build({entryPoints:['scripts/verify/voice-call-rhythm-preview.tsx'],outfile:'preview.js',bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"preview"'},plugins:before?[{name:'before-source',setup(b){b.onResolve({filter:/^\./},args=>{const path=resolve(args.resolveDir,args.path);if(path.startsWith(sourcePrefix)){const base=resolve(dir,'before/src',path.slice(sourcePrefix.length));const file=[base,base+'.ts',base+'.tsx',join(base,'index.ts')].find(candidate=>existsSync(candidate)&&/\.[a-z]+$/i.test(candidate));if(!file)throw Error('Missing baseline file '+base);return{path:file};}});}}]:[]});}
const bundles=new Map();for(const before of serve?[false]:[true,false])bundles.set(before,await bundle(before));
const server=createServer((req,res)=>{
 const before=req.url?.startsWith('/before');const bundled=bundles.get(before)??bundles.get(false);
 res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; img-src 'self' data: blob:");
 if(req.url?.endsWith('.js')){res.setHeader('Content-Type','application/javascript');res.end(bundled.outputFiles.find(f=>f.path.endsWith('.js')).text);return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>通话隔离预览 · 无模型/麦克风/声音</title><style>${css}\n${bundled.outputFiles.find(f=>f.path.endsWith('.css')).text}</style></head><body><div id="root"></div><script>navigator.mediaDevices && (navigator.mediaDevices.getUserMedia=()=>Promise.reject(Error('preview microphone blocked')));</script><script src="${before?'/before':'/after'}.js"></script></body></html>`);
});await new Promise(r=>server.listen(serve?previewPort:0,'127.0.0.1',r));const address='http://127.0.0.1:'+server.address().port+'/?virtugene-preview=mobile';
if(serve){console.log('Isolated actual call component preview: '+address+' (no microphone, model or sound)');}
else{
 const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');const browser=await chromium.launch({channel:'chrome',headless:true});let external=0;
 try{for(const label of ['before','after']){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const page=await context.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(external++,route.abort()));
  await page.goto(address.replace('/?',`/${label}?`));await page.waitForFunction(()=>window.rhythmPreview?.ready);await page.getByRole('dialog').waitFor();await page.screenshot({path:dir+'/'+label+'-captions.png'});
  const defaultCaptionCount=await page.locator('.vg-voice-call-captions').count();
  writeFileSync(dir+'/'+label+'-preview.json',JSON.stringify({defaultCaptionCount,externalRequests:external,realApiCalls:0,microphone:false,sound:false,scope:'actual component with isolated UI state, not actual conversation'},null,2));
  if(label==='after'){if(defaultCaptionCount)throw Error('captions unexpectedly visible');await page.getByRole('button',{name:'显示字幕',exact:true}).click();await page.evaluate(()=>window.rhythmPreview.speaking());await page.screenshot({path:dir+'/after-opt-in-captions.png'});}
  await context.close();
 }}finally{await browser.close();server.close();}
 console.log('Before/after actual component screenshots captured; external requests='+external);
}
