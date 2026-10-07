import { build } from 'vite';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const filename = process.argv[2] ?? '.tmp-preview/bundle-after.json';
await build({
  build: { manifest: true },
  plugins: [{
    name: 'bundle-dependency-report',
    generateBundle: {
      // Vite injects dynamic-import preload helpers in generateBundle. Measure the final emitted code.
      order: 'post',
      handler(_options, bundle) {
        const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
        const startup = new Set();
        const walk = name => {
          if (startup.has(name)) return;
          startup.add(name);
          for (const dependency of bundle[name]?.imports ?? []) walk(dependency);
        };
        const entry = chunks.find(chunk => chunk.isEntry);
        if (!entry) throw new Error('Application entry missing');
        walk(entry.fileName);
        const output = chunks.map(chunk => ({
          name: chunk.fileName,
          bytes: Buffer.byteLength(chunk.code),
          gzip: gzipSync(chunk.code).length,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: Object.entries(chunk.modules).map(([id, module]) => ({
            id: id.replaceAll('\\', '/'), bytes: module.renderedLength,
            importers: this.getModuleInfo(id)?.importers ?? [],
          })).sort((a, b) => b.bytes - a.bytes),
        }));
        const initial = output.filter(chunk => startup.has(chunk.name));
        const report = {
          entry: entry.fileName, startup: [...startup],
          startupBytes: initial.reduce((total, chunk) => total + chunk.bytes, 0),
          startupGzip: initial.reduce((total, chunk) => total + chunk.gzip, 0), chunks: output,
        };
        mkdirSync(dirname(filename), { recursive: true });
        writeFileSync(filename, JSON.stringify(report, null, 2));
      },
    },
  }],
});
