import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const evidence = '.tmp-preview/voice-call-boundary-audit-20261015';
mkdirSync(evidence, { recursive: true });
const modes = process.argv.includes('--before-only') ? ['before'] : ['before', 'after'];
for (const mode of modes) {
  const outfile = join(evidence, `${mode}.cjs`);
  await build({ entryPoints: ['scripts/verify/voice-call-boundary-audit.ts'], outfile, bundle: true, platform: 'node', format: 'cjs',
    plugins: mode === 'before' ? [{ name: 'two-early-before-fix', setup(builder) {
      builder.onLoad({ filter: /voice-call[\\/](controller|utterance)\.ts$/ }, args => ({ contents: readFileSync(join(evidence, 'before', args.path.split(/[\\/]/).pop()), 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
    } }] : [] });
  const run = spawnSync(process.execPath, [outfile, ...(mode === 'before' ? ['--before'] : [])], { encoding: 'utf8', timeout: 10_000 });
  writeFileSync(join(evidence, `${mode}-result.txt`), (run.stdout ?? '') + (run.stderr ?? '') + (run.error ?? ''));
  if (run.status !== 0) { console.error(run.stderr || run.error); process.exitCode = 1; break; }
  const report = JSON.parse(run.stdout);
  report.bundleSha256 = createHash('sha256').update(readFileSync(outfile)).digest('hex');
  writeFileSync(join(evidence, `${mode}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, saturation: report.saturation, lateContinuation: report.lateContinuation, delayedCapture: report.delayedCapture }));
}
