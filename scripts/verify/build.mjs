/**
 * 一键打包验收脚本（避免手写 esbuild 参数时的引号转义问题）
 *
 *   node scripts/verify/build.mjs
 *
 * 说明：iife 产物没有 import.meta，而应用代码会读 import.meta.env
 * （Vite 平时注入 VITE_AI_GATEWAY_URL / VITE_AI_GATEWAY_TOKEN），
 * 同时 vite.config.ts 还会注入裸标识符 __APP_VERSION__（应用版本号）。
 * 这里把两者都补上——只影响验收产物，不影响真实构建。
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));

const shared = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  logLevel: 'warning',
  define: {
    'import.meta.env': JSON.stringify({
      VITE_AI_GATEWAY_URL: '',
      VITE_AI_GATEWAY_TOKEN: '',
    }),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
};

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase1.ts'],
  outfile: 'scripts/verify/phase1.bundle.js',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase2a.ts'],
  outfile: 'scripts/verify/phase2a.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase2b0.ts'],
  outfile: 'scripts/verify/phase2b0.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase2b1.ts'],
  outfile: 'scripts/verify/phase2b1.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase2b2.ts'],
  outfile: 'scripts/verify/phase2b2.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase2b3.ts'],
  outfile: 'scripts/verify/phase2b3.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase2b4.ts'],
  outfile: 'scripts/verify/phase2b4.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase2b5.ts'],
  outfile: 'scripts/verify/phase2b5.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase2b6.ts'],
  outfile: 'scripts/verify/phase2b6.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase3.ts'],
  outfile: 'scripts/verify/phase3.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase3b.ts'],
  outfile: 'scripts/verify/phase3b.bundle.js',
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['scripts/verify/phase3c.ts'],
  outfile: 'scripts/verify/phase3c.bundle.js',
  jsx: 'automatic',
});

console.log('✅ 验收脚本已打包：phase1 / phase2a / phase2b0 / phase2b1 / phase2b2 / phase2b3 / phase2b4 / phase2b5 / phase2b6 / phase3 / phase3b / phase3c');
