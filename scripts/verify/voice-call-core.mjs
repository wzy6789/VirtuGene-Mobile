import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('.tmp-preview/voice-call', { recursive: true });
await build({ entryPoints: ['scripts/verify/voice-call-core.ts'], outfile: '.tmp-preview/voice-call/core.cjs', bundle: true, platform: 'node', format: 'cjs' });
const result = spawnSync(process.execPath, ['.tmp-preview/voice-call/core.cjs'], { encoding: 'utf8' });
writeFileSync('.tmp-preview/voice-call/core-result.txt', (result.stdout ?? '') + (result.stderr ?? ''), 'utf8');
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
