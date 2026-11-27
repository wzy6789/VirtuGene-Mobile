import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../website/', import.meta.url));
if (!process.argv[2]) throw new Error('Specify an empty destination directory for the website.');
const destination = resolve(process.argv[2]);
const sourcePath = resolve(source);
if (destination === sourcePath || destination.startsWith(sourcePath + sep)) {
  throw new Error('Choose a destination outside the website source directory.');
}
await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length) throw new Error('The destination must be empty.');

const files = new Set(['index.html', 'privacy.html', 'terms.html', 'assets/v7/OFL-Allura.txt', 'assets/atelier/OFL-NotoSerifSC.txt']);
function include(file, reference) {
  if (!reference || /^(?:#|\/\/|[a-z][a-z\d+.-]*:)/i.test(reference)) return;
  const name = reference.split(/[?#]/, 1)[0];
  if (!name) return;
  const path = relative(sourcePath, resolve(sourcePath, dirname(file), decodeURIComponent(name)));
  if (path.startsWith('..' + sep) || path === '..' || /^[A-Za-z]:/.test(path)) throw new Error('Invalid asset path: ' + name);
  files.add(path.split(sep).join('/'));
}
for (const file of files) {
  const from = resolve(sourcePath, file);
  if (!(await stat(from)).isFile()) throw new Error('Missing website file: ' + file);
  const ext = extname(file);
  if (ext === '.html' || ext === '.css') {
    const text = await readFile(from, 'utf8');
    if (ext === '.html') {
      for (const match of text.matchAll(/\b(?:src|href|poster)=["']([^"']*)["']/g)) include(file, match[1]);
      for (const match of text.matchAll(/\bsrcset=["']([^"']+)["']/g)) {
        for (const item of match[1].split(',')) include(file, item.trim().split(/\s+/)[0]);
      }
    } else {
      for (const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) include(file, match[1]);
    }
  }
  const target = resolve(destination, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(from, target);
}
console.log('Exported ' + files.size + ' website files.');
