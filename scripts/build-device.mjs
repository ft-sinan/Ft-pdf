// Build-only. No Node runtime, localhost listener or server configuration is packaged.
import { build } from 'vite';
import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openStore, createDemo, workspace } from '../server/store.mjs';
const assets = resolve('android/app/build/generated/ftAssets'),
  studio = join(assets, 'studio'),
  seed = join(assets, 'seed');
await build({ mode: 'android', publicDir: false, build: { outDir: studio, emptyOutDir: true } });
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
await mkdir(seed, { recursive: true });
const db = openStore(':memory:');
try {
  const owner = await createDemo(db),
    { documents, collections } = workspace(db, owner),
    now = Date.now();
  for (const [i, d] of documents.entries()) {
    const f = db.prepare('select bytes,content from documents where id=?').get(d.id);
    await writeFile(join(seed, i + '.bin'), f.bytes);
    await writeFile(join(seed, i + '.txt'), f.content);
  }
  await writeFile(
    join(seed, 'manifest.json'),
    JSON.stringify({
      collections,
      documents: documents.map((d) => ({ ...d, age: now - d.updated })),
    }),
  );
} finally {
  db.close();
}
console.log('Packaged the studio, PDF resources and 12 real example files for Android.');
