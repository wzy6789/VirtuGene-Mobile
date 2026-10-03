import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { copyRendererStyles } from './copy-renderer-styles.mjs';
copyRendererStyles();
const version = JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version);
await Promise.all([true, false].map(dev => build({
  entryPoints: ['scripts/verify/settings-ui.tsx'],
  outfile: `scripts/verify/settings-ui${dev ? '' : '-desktop'}.bundle.js`,
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.png': 'dataurl', '.webp': 'dataurl' },
  define: { 'import.meta.env': JSON.stringify({ DEV: dev, VITE_AI_GATEWAY_URL: '', VITE_AI_GATEWAY_TOKEN: '' }), __APP_VERSION__: version },
})));
