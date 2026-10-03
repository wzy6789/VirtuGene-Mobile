import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/** Keep fixture font requests local, including runners that flatten URL paths. */
export function copyRendererStyles() {
  const assets = new URL('../../dist/renderer/assets/', import.meta.url);
  const css = readdirSync(assets).filter(name => name.endsWith('.css')).sort().pop();
  if (!css) throw new Error('Build the renderer before copying verification styles.');
  for (const name of readdirSync(assets).filter(name => name.endsWith('.woff2'))) {
    copyFileSync(new URL(name, assets), new URL(name, import.meta.url));
  }
  const styles = readFileSync(new URL(css, assets), 'utf8').replace(/url\((['"]?)\/assets\/([^)'"/]+\.woff2)\1\)/g, (_, _quote, name) => `url("./${name}")`);
  writeFileSync(new URL('./verify.css', import.meta.url), styles);
  return css;
}
