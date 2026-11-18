// Exercise the actual production chunks and OCR assets destined for the APK, with no server API.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PDF } from '@libpdf/core';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import mammoth from 'mammoth';
import { wordFile } from '../server/formats.mjs';
const studio = resolve('android/app/build/generated/ftAssets/studio'),
  dir = await mkdtemp(join(tmpdir(), 'ft-tools-')),
  logs = [];
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.HelveticaBold);
for (const [i, s] of ['FIELD NOTES', 'STUDIO EDITION'].entries())
  pdf.addPage([440 + i * 20, 280]).drawText(s, { x: 38, y: 140, size: 38, font });
await writeFile(join(dir, 'source.pdf'), await pdf.save({ useObjectStreams: false }));
await writeFile(
  join(dir, 'word.docx'),
  await wordFile('<h1>Local heading</h1><p>Local paragraph</p>', 'Local'),
);
await writeFile(
  join(dir, 'sheet.pptx'),
  zipSync(
    Object.fromEntries(
      Object.entries({
        'ppt/presentation.xml':
          '<p:presentation xmlns:p="urn:p" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>',
        'ppt/_rels/presentation.xml.rels':
          '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>',
        'ppt/slides/slide1.xml': '<p xmlns="urn:p"><t>Slide example</t></p>',
      }).map(([k, v]) => [k, strToU8(v)]),
    ),
  ),
);
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  try {
    if (path === '/' || path === '/test') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<div id="root"></div>');
    }
    const root = path.startsWith('/fixture/') ? dir : studio,
      file = resolve(root, '.' + path.replace(/^\/fixture\//, '/'));
    if (!file.startsWith(root + '/')) throw Error('path');
    const data = await readFile(file);
    res.setHeader(
      'Content-Type',
      {
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.ttf': 'font/ttf',
      }[extname(file)] || 'application/octet-stream',
    );
    if (path.startsWith('/ocr/') && path.endsWith('.js'))
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'",
      );
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port,
  browser = await chromium.launch({
    executablePath: process.env.FT_CHROMIUM || undefined,
    args: ['--no-sandbox'],
  });
try {
  const page = await browser.newPage();
  await page.route('**/*', (r) =>
    r.request().url().startsWith(base) || r.request().url().startsWith('blob:')
      ? r.continue()
      : r.abort(),
  );
  page.on('console', (m) => {
    if (m.type() === 'error') logs.push(m.text());
  });
  page.on('pageerror', (e) => logs.push(e.message));
  await page.goto(base + '/test');
  const runner = (await readdir(join(studio, 'assets'))).find((n) => /^run-.*\.js$/.test(n));
  assert.ok(runner);
  await page.evaluate(async (runner) => {
    const { runTool } = await import('/assets/' + runner);
    window.fixtures = {};
    for (const name of ['source.pdf', 'word.docx', 'sheet.pptx'])
      window.fixtures[name] = new File([await (await fetch('/fixture/' + name)).blob()], name);
    window.fixtures['markup.html'] = new File(
      ['<h2>Offline HTML</h2><script>bad()</script>'],
      'markup.html',
    );
    window.tool = async (op, inputs, output, opts) => {
      const c = document.createElement('canvas');
      c.width = 90;
      c.height = 30;
      c.getContext('2d').fillText('Signed', 1, 18);
      const options = {
        range: '',
        mode: '',
        value: '',
        position: 'right',
        boxes: [],
        signature: c.toDataURL(),
        ...opts,
      };
      const res = await runTool(
        op,
        inputs.map((n) => window.fixtures[n]),
        options,
        () => {},
        new AbortController().signal,
      );
      if ('text' in res) return { text: res.text };
      window.fixtures[output] = new File([res.bytes], output);
      const data = await res.bytes.arrayBuffer();
      let s = '';
      for (const i of new Uint8Array(data)) s += String.fromCharCode(i);
      return { data: btoa(s), ext: res.ext };
    };
  }, runner);
  const run = async (op, inputs = ['source.pdf'], opts = {}, output = op + '.pdf') => {
    const v = await page.evaluate(
      ([op, inputs, out, opts]) => window.tool(op, inputs, out, opts),
      [op, inputs, output, opts],
    );
    console.log('OK', op, output);
    return v.data ? Buffer.from(v.data, 'base64') : v.text;
  };
  const p = async (...a) => PDFDocument.load(await run(...a));
  assert.equal((await p('merge', ['source.pdf', 'source.pdf'])).getPageCount(), 4);
  assert.equal((await p('extract', undefined, { range: '2,1' })).getPage(0).getWidth(), 460);
  assert.equal((await p('remove', undefined, { range: '1' })).getPageCount(), 1);
  assert.equal((await p('rotate', undefined, { mode: '90' })).getPage(0).getRotation().angle, 90);
  assert.equal((await p('crop', undefined, { value: '12' })).getPage(0).getCropBox().width, 416);
  const parts = unzipSync(await run('split', undefined, { range: '2;1' }));
  assert.equal((await PDFDocument.load(parts['Part-001.pdf'])).getPage(0).getWidth(), 460);
  assert.equal((await p('watermark', undefined, { value: 'Studio' })).getPageCount(), 2);
  assert.equal((await p('numbers')).getPageCount(), 2);
  assert.equal((await p('sign')).getPageCount(), 2);
  assert.equal((await p('repair')).getPageCount(), 2);
  assert.equal((await p('flatten')).getPageCount(), 2);
  assert.equal((await p('compare', ['source.pdf', 'flatten.pdf'])).getPageCount(), 2);
  const img = await run('tojpg', undefined, { range: '1' });
  assert.equal(img.readUInt16BE(), 0xffd8);
  assert.equal(Object.keys(unzipSync(await run('tojpg'))).length, 2);
  const wc = await run('toword', undefined, {}, 'frompdf.docx');
  assert.match((await mammoth.extractRawText({ buffer: wc })).value, /FIELD NOTES/);
  assert.match(await run('fromword', ['word.docx']), /Local paragraph/);
  assert.equal(await run('fromhtml', ['markup.html']), 'Offline HTML');
  assert.match(await run('fromslides', ['sheet.pptx']), /Slide example/);
  const xl = unzipSync(await run('toexcel', undefined, {}, 'grid.xlsx'));
  assert.match(strFromU8(xl['xl/worksheets/sheet1.xml']), /FIELD NOTES/);
  assert.match(await run('fromexcel', ['grid.xlsx']), /FIELD NOTES/);
  assert.ok(unzipSync(await run('toslides'))['ppt/slides/slide2.xml']);
  const encrypted = await run('protect', undefined, { value: 'offline-pass' }, 'locked.pdf');
  const locked = await PDF.load(encrypted);
  assert.equal(locked.isEncrypted, true);
  assert.equal(locked.isAuthenticated, false);
  await assert.rejects(() => run('unlock', ['locked.pdf'], { value: 'incorrect' }));
  assert.equal((await p('unlock', ['locked.pdf'], { value: 'offline-pass' })).getPageCount(), 2);
  assert.equal(
    (await p('redact', undefined, { boxes: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] })).getPageCount(),
    2,
  );
  await assert.rejects(() => run('toword', ['redact.pdf']), /No selectable text/);
  assert.equal((await p('ocr', ['flatten.pdf'], { range: '1' })).getPageCount(), 1);
  const recognized = await run('toword', ['ocr.pdf']);
  assert.match((await mammoth.extractRawText({ buffer: recognized })).value, /FIELD NOTES/i);
  const small = await run('compress', ['flatten.pdf'], { mode: 'image' }).catch((e) => {
    assert.match(String(e), /already smaller/);
    return null;
  });
  if (small) assert.ok(small.length);
  await assert.rejects(() => run('remove', undefined, { range: '1-2' }), /Keep at least one/);
  await assert.rejects(() => run('extract', undefined, { range: '2040' }));
  console.log('Offline toolbox interoperability checks passed.');
} catch (e) {
  console.error(logs.slice(-8));
  throw e;
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
