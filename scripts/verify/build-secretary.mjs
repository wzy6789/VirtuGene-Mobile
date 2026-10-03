import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { copyRendererStyles } from './copy-renderer-styles.mjs';
copyRendererStyles();
await build({ entryPoints: ['scripts/verify/secretary.tsx'], outfile: 'scripts/verify/secretary.bundle.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': JSON.stringify({ DEV: true, VITE_AI_GATEWAY_URL: '', VITE_AI_GATEWAY_TOKEN: '' }), __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) } });
await build({ entryPoints: ['scripts/verify/secretary-memory.tsx'], outfile: 'scripts/verify/secretary-memory.bundle.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': JSON.stringify({ DEV: true, VITE_AI_GATEWAY_URL: '', VITE_AI_GATEWAY_TOKEN: '' }), __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) } });
if (process.argv.includes('--with-regressions')) {
  const suites = ['character-create', 'moments', 'memory-unified', 'memory-attention', ...(process.argv.includes('--with-domain-regressions') ? ['worldF', 'worldG', 'worldA', 'worldC', 'character-memory', 'memory-final', 'memory-continuity'] : [])];
  for (const name of suites) {
    await build({ entryPoints: [`scripts/verify/${name}.ts`], outfile: `scripts/verify/${name}.bundle.js`, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': JSON.stringify({ DEV: true, VITE_AI_GATEWAY_URL: '', VITE_AI_GATEWAY_TOKEN: '' }), __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) } });
  }
}
