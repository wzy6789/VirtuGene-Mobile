import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';

const checks = [
  ['role', ['scripts/verify/luxueqi-preset.mjs']],
  ['expression', ['scripts/verify/chat-expression.mjs']],
  ['existing-voice', ['scripts/verify/preset-voice.mjs']],
  ['types', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['renderer', ['node_modules/vite/bin/vite.js', 'build']],
];
const rows = await Promise.all(checks.map(([name, args]) => new Promise(resolve => {
  const log = `release/luxueqi-final-${name}-2026-10-10.log`;
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', fd, fd] });
  let closed = false;
  const finish = (code, error) => {
    if (closed) return; closed = true; closeSync(fd);
    const result = { name, args, code, log, ...(error ? { error } : {}) };
    console.log(JSON.stringify(result)); resolve(result);
  };
  child.once('error', error => finish(-1, error.message));
  child.once('exit', code => finish(code));
})));
const report = { date: new Date().toISOString(), appVersion: JSON.parse(readFileSync('package.json', 'utf8')).version, rows, pass: rows.every(row => row.code === 0), modelCalls: 0 };
writeFileSync('docs/LUXUEQI-CHECKS-2026-10-10.json', JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
