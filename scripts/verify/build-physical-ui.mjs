import { build } from 'esbuild';
import { readFileSync, readdirSync, copyFileSync } from 'node:fs';
const files = readdirSync('dist/renderer/assets').filter(f=>f.endsWith('.css'));
const appVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
copyFileSync(`dist/renderer/assets/${files[0]}`, 'scripts/verify/verify.css');
await build({entryPoints:['scripts/verify/physical-ui.tsx'],outfile:'scripts/verify/physical-ui.bundle.js',bundle:true,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"DEV":true,"VITE_AI_GATEWAY_URL":"","VITE_AI_GATEWAY_TOKEN":""}',__APP_VERSION__:JSON.stringify(appVersion)},plugins:[{
  name:'native-boundary-only',setup(build){
    build.onLoad({filter:/[\\/]lib[\\/]platform\.ts$/},args=>({contents:readFileSync(args.path,'utf8').replace('export const IS_CAPACITOR = isCapacitorPlatform();','export const IS_CAPACITOR = true;'),loader:'ts'}));
    build.onLoad({filter:/[\\/]lib[\\/]recorder\.ts$/},()=>({contents:`
      export class AudioRecorder { t=0; cb=null; get elapsedMs(){return this.t ? Date.now()-this.t : 0;}
        async start(cb){window.voiceMock.starts++;await new Promise(r=>setTimeout(r,window.voiceMock.startDelay));this.t=Date.now();cb(.55);}
        async stop(){window.voiceMock.stops++;return {dataUrl:'data:audio/aac;base64,TEST',durationSec:this.elapsedMs/1000};}
        cancel(){window.voiceMock.cancels++;}
      }`,loader:'js'}));
    build.onLoad({filter:/[\\/]lib[\\/]speech-recognition\.ts$/},()=>({contents:`
      export async function ensureRecordPermission(){await new Promise(r=>setTimeout(r,window.voiceMock.permissionDelay));return window.voiceMock.granted;}
      export async function startSpeechRecognition(){return true;}
      export async function stopSpeechRecognition(){return '你好，今天见面吧';}
      export async function cancelSpeechRecognition(){}
      export async function isSpeechAvailable(){return true;}`,loader:'js'}));
  }
}]});
console.log('Built real UI components; only microphone/recognition native boundaries are mocked.');
