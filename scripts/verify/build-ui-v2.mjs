import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {copyRendererStyles} from './copy-renderer-styles.mjs';
copyRendererStyles();
await build({entryPoints:['scripts/verify/ui-v2.tsx'],outfile:'scripts/verify/ui-v2.bundle.js',bundle:true,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':JSON.stringify({DEV:true,VITE_AI_GATEWAY_URL:'',VITE_AI_GATEWAY_TOKEN:''}),__APP_VERSION__:JSON.stringify(JSON.parse(readFileSync('package.json','utf8')).version)}});
