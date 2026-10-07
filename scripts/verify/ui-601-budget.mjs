import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const directory = 'dist/renderer/assets';
const css = readdirSync(directory).filter(name => name.endsWith('.css'));
const js = readFileSync('dist/renderer/index.html', 'utf8').match(/<script[^>]+src="[^\"]*\/assets\/([^\"]+\.js)"/)?.[1];
assert.ok(js, 'Renderer HTML must identify its actual entry bundle');
const current = { cssBytes: css.reduce((sum, name) => sum + statSync(`${directory}/${name}`).size, 0), cssGzip: css.reduce((sum, name) => sum + gzipSync(readFileSync(`${directory}/${name}`)).length, 0), mainBytes: statSync(`${directory}/${js}`).size, mainGzip: gzipSync(readFileSync(`${directory}/${js}`)).length };
const baselineFile = 'docs/UI-6.0.1-BASELINE.json';
if (process.argv.includes('--baseline')) {
  writeFileSync(baselineFile, JSON.stringify({ recordedAt: new Date().toISOString(), ...current }, null, 2) + '\n');
  console.log('Recorded 6.0.1 UI baseline', current);
} else {
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  assert.ok(current.cssGzip <= baseline.cssGzip * 1.15, `CSS gzip ${current.cssGzip} exceeds +15% budget ${Math.floor(baseline.cssGzip * 1.15)}`);
  console.log('PASS 6.0.1 CSS budget', JSON.stringify({ baseline, current, cssGrowth: `${((current.cssGzip / baseline.cssGzip - 1) * 100).toFixed(2)}%` }));
}
