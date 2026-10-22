import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
await build({ entryPoints: ['scripts/verify/voice-call-transport.ts'], outfile: '.tmp-preview/voice-call/transport.cjs', bundle: true, platform: 'node', format: 'cjs' });
const result = spawnSync(process.execPath, ['.tmp-preview/voice-call/transport.cjs'], { encoding: 'utf8', timeout: 10000 });
writeFileSync('.tmp-preview/voice-call/transport-result.txt', (result.stdout ?? '') + (result.stderr ?? ''), 'utf8');
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
