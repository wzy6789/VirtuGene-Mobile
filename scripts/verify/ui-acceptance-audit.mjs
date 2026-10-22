import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const log=p=>{const bytes=readFileSync(p);return bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');};
const checks=[
 ['settings','ui-final-preferences-20261013/result.json','passed'],
 ['main-shell','ui-final-shell-20261013/result.json','checks'],
 ['world-diary-memory-story','ui-final-deep-20261013/result.json','checks'],
 ['registration-announcement','first-entry-announcement-ui-20261013/result.json','passed'],
 ['fusion-expression-samples','final-dialogs-ui-20261013/result.json','passed'],
 ['reply-memory-basis','memory-basis-ui-20261013/result.json','passed'],
 ['group-touch','group-touch-motion-20261013/result.json','checks'],
].map(([scope,file,key])=>{const path='.tmp-preview/'+file,r=json(path);assert.ok(r[key]>0);assert.deepEqual(r.errors??[],[]);return {scope,checks:r[key],path,sha256:sha(path)};});
for(const [scope,file,pattern] of [
 ['streaming-chat','chat',/PASS chat-stream-ui: (\d+) checks/],
 ['orb-mathematics','math',/PASS (\d+) soul orb motion checks/],
 ['modal-motion','modal',/PASS (\d+) modal motion checks/],
]) {const path=`.tmp-preview/ui-final-${file}-20261013.log`,match=log(path).match(pattern);assert.ok(match,path);checks.push({scope,checks:Number(match[1]),path,sha256:sha(path)});}
const perf=json('.tmp-preview/ui-performance/result.json');assert.equal(perf.unchangedNotificationRenders,0);assert.equal(perf.completedBubbleRenders,0);assert.equal(perf.remainingAnimations,0);assert.deepEqual(perf.errors,[]);
const assets='dist/renderer/assets',css=readdirSync(assets).filter(p=>p.endsWith('.css'));
const cssGzip=css.reduce((n,p)=>n+gzipSync(readFileSync(`${assets}/${p}`)).length,0),baseline=json('docs/UI-6.0.1-BASELINE.json');assert.ok(cssGzip<=baseline.cssGzip*1.15);
const productionIndex=readFileSync('dist/renderer/index.html','utf8'),entries=[...productionIndex.matchAll(/(?:src|href)="([^" ]+)"/g)].map(m=>m[1]);
const sources=['src/components/character/FusionModal.tsx','src/components/chat/ReviewedSpeechModal.tsx','src/components/chat/MemoryBasisModal.tsx','src/styles/ui-performance.css'];
const report={recordedAt:new Date().toISOString(),status:'ready-for-user-browser-acceptance',version:json('package.json').version,checks,performance:{path:'.tmp-preview/ui-performance/result.json',sha256:sha('.tmp-preview/ui-performance/result.json'),...perf},build:{typeCheckExit:0,buildExit:0,logs:['.tmp-preview/ui-final-types-20261013.log','.tmp-preview/ui-final-build-20261013.log'],entries,cssGzip,baselineCssGzip:baseline.cssGzip,cssGrowth:((cssGzip/baseline.cssGzip-1)*100).toFixed(2)+'%',artifacts:readdirSync(assets).filter(p=>/\.(css|js)$/.test(p)).map(p=>({path:`${assets}/${p}`,sha256:sha(`${assets}/${p}`)}))},sourceSnapshot:sources.map(path=>({path,sha256:sha(path)})),preview:'http://127.0.0.1:5173/?virtugene-preview=mobile',modelCalls:0,apiTokens:0,packagedOrPublished:false,limitations:['No Android device: GPU/frame pacing, physical keyboard/IME, native back, audio routing, lock-screen and haptics not verified.','Fusion model and expression-sample services are controlled in the final dialog fixture; tests validate UI contracts, not model quality or persistence correctness.','Checks overlap and are not a count of distinct features. Browser success is not a claim of flawless UI.','Main entry gzip is about 223KB versus 164KB historical baseline; shared workspace contains concurrent non-UI voice/model work. No attribution of all bundle growth to this UI batch.','Original design proposal is a reference, not a claim that every optional signature animation or every component has exhaustive coverage.'],interimIssues:['Modal OS reduced-motion focus outline transition was real; production CSS fixed and 46 checks passed.','Main/deep fixtures used old onboarding button label; updated locator to current text, without changing product behavior.','Performance fixture counted before intentionally delayed second bubble appeared; await finish drain, keep zero extra-render assertion.','Initial final-dialog fixture omitted a task-client export; fixture repaired; original failure log preserved.']};
assert.equal(report.version,'6.1.0');writeFileSync('.tmp-preview/ui-acceptance-audit-20261013.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,version:report.version,suites:checks.map(c=>({scope:c.scope,checks:c.checks})),cssGrowth:report.build.cssGrowth,preview:report.preview},null,2));
