// Build-only. No Node runtime, localhost listener or server configuration is packaged.
import { build } from 'vite';
import { cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const assets = resolve('android/app/build/generated/ftAssets'),
  studio = join(assets, 'studio');
// Also clean stale sample assets on incremental Gradle builds from 3.1.
await rm(join(assets, 'seed'), { recursive: true, force: true });
await build({ mode: 'android', publicDir: false, build: { outDir: studio, emptyOutDir: true } });
// The trusted contact card and Android's exact external-link allowlist share one source.
await cp('shared/creator-contacts.json', join(assets, 'creator-contacts.json'));
await Promise.all(
  ['brand.svg', 'fonts', 'icons'].map((p) =>
    cp(join('public', p), join(studio, p), { recursive: true }),
  ),
);
for (const [from, to] of [
  ['cmaps', 'cmaps'],
  ['standard_fonts', 'fonts'],
])
  await cp(`node_modules/pdfjs-dist/${from}`, join(studio, 'pdf-assets', to), { recursive: true });
await mkdir(join(studio, 'ocr'), { recursive: true });
for (const [from, to] of [
  ['tesseract.js/LICENSE.md', 'tesseract.LICENSE'],
  ['tesseract.js/dist/worker.min.js.LICENSE.txt', 'worker.LICENSE.txt'],
  ['tesseract.js-core/LICENSE', 'core.LICENSE'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'english-model.bin'],
])
  await cp(join('node_modules', from), join(studio, 'ocr', to));
// Classic worker: define TesseractCore before the worker attaches its message listener.
// Its embedded WASM and the model (sent as bytes) require no network from the worker.
await writeFile(
  join(studio, 'ocr', 'worker.js'),
  Buffer.concat([
    await readFile('node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'),
    Buffer.from('\n;\n'),
    await readFile('node_modules/tesseract.js/dist/worker.min.js'),
  ]),
);
const html = join(studio, 'index.html');
await writeFile(html, (await readFile(html, 'utf8')).replace(/\s*<link rel="manifest"[^>]+>/, ''));
console.log('Packaged the offline studio without any sample library files.');
