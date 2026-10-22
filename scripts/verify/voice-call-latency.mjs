import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const evidence = '.tmp-preview/voice-call-latency-20261015';
mkdirSync(evidence, { recursive: true });
for (const mode of ['before', 'after']) {
  const output = `${evidence}/${mode}.cjs`;
  await build({ entryPoints: ['scripts/verify/voice-call-latency.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs',
    plugins: mode === 'before' ? [{ name: 'snapshot-only', setup(b) {
      b.onLoad({ filter: /voice-call[\\/](controller|utterance)\.ts$/ }, args => ({ contents: readFileSync(`${evidence}/before/${args.path.split(/[\\/]/).pop()}`, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
    } }] : [] });
  const result = spawnSync(process.execPath, [output, ...(mode === 'before' ? ['--before'] : [])], { encoding: 'utf8', timeout: 20000 });
  writeFileSync(`${evidence}/${mode}-result.txt`, (result.stdout ?? '') + (result.stderr ?? '') + (result.error ?? ''));
  if (result.status !== 0) { console.error(result.stderr || result.error); process.exitCode = 1; break; }
  const report = JSON.parse(result.stdout.trim()); writeFileSync(`${evidence}/${mode}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, checks: report.checks, scenarios: report.scenarios.map(x => ({ delays: x.delays, speechToFirstPlaybackMs: x.metrics.firstPlaybackFromSpeechMs })) }));
}
