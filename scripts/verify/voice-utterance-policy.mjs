import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
const dir = '.tmp-preview/voice-utterance-policy-20261015';
mkdirSync(dir, { recursive: true });
const baseline = process.argv.includes('--baseline');
const mode = baseline ? 'before' : 'after';
await build({ entryPoints: ['scripts/verify/voice-utterance-policy.ts'], outfile: `${dir}/${mode}.cjs`, bundle: true, platform: 'node', format: 'cjs',
  plugins: baseline ? [{ name: 'frozen-utterance', setup(b) {
    b.onLoad({ filter: /voice-call[\\/]utterance\.ts$/ }, args => ({ contents: readFileSync(`${dir}/before/utterance.ts`, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
  } }] : [] });
const run = spawnSync(process.execPath, [`${dir}/${mode}.cjs`, ...(baseline ? ['--baseline'] : [])], { encoding: 'utf8', timeout: 30_000 });
writeFileSync(`${dir}/${mode}-result.txt`, (run.stdout ?? '') + (run.stderr ?? ''), 'utf8');
writeFileSync(`${dir}/${mode}-latest-run.json`, JSON.stringify({ exitCode: run.status, error: run.error?.message ?? null, time: new Date().toISOString() }, null, 2));
process.stderr.write(run.stderr ?? '');
if (run.status === 0) {
  const report = JSON.parse(run.stdout.trim());
  report.sourceHash = createHash('sha256').update(readFileSync(baseline ? `${dir}/before/utterance.ts` : 'src/lib/voice-call/utterance.ts')).digest('hex');
  writeFileSync(`${dir}/${mode}.json`, JSON.stringify(report, null, 2));
  if (!baseline) {
    const before = JSON.parse(readFileSync(`${dir}/before.json`, 'utf8'));
    if (before.textFixtureHash !== report.textFixtureHash || JSON.stringify(before.rows) !== JSON.stringify(report.rows)) throw new Error('frozen and current fixture / endpoint mismatch');
    writeFileSync(`${dir}/comparison.json`, JSON.stringify({ baselineHash: before.sourceHash, currentHash: report.sourceHash, textFixtureHash: report.textFixtureHash,
      checks: { before: before.checks, after: report.checks }, endpoint: report.endpoint, rowsPerVariant: report.rows.length,
      firstTextPhrase: { before: before.segmentation, after: report.segmentation }, realApiCalls: 0, modelTokens: 0,
      boundaries: ['No generated answer quality or physical audio latency measured.', 'English unpunctuated prose waits for whole-token/safe clause boundaries; generic whitespace split now needs 100 code points and right context, so some English fragments deliberately wait longer.', 'No-boundary buffers are capped at 1024 Unicode code points; overflow fails explicitly rather than clipping.', 'Candidate RMS-only endpoint policies are test-only; production remains 700ms.', 'TV-like energy, below-threshold light speech, and pauses longer than 700ms remain explicit gate limitations.'] }, null, 2));
  }
  console.log(JSON.stringify({ mode, checks: report.checks, endpointRounds: report.rows.length, firstPhrase: report.segmentation[0], falseEnds: report.endpoint.filter(row => row.falseEnds), realApiCalls: 0 }));
}
process.exitCode = run.status ?? 1;
