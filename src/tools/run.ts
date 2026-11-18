import { PDFDocument, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import { zipSync } from 'fflate';
import { canvasBlob, MB } from './photos';
import { pageRange, type Box } from './pages';
import type { Tool } from './catalog';
import { openPdf, render, textRows } from './pdfview';
import { workbook, escapeXml, plainHTML, officeText } from './office';
import type { PDFDocumentProxy } from 'pdfjs-dist';
export type Options = {
  range: string;
  value: string;
  mode: string;
  position: string;
  signature?: string;
  boxes: Box[];
};
export type Result =
  | {
      ext: 'pdf' | 'docx' | 'jpg' | 'zip' | 'xlsx' | 'pptx';
      bytes: Blob;
      pages?: number | null;
      locked?: boolean;
      content?: string;
    }
  | { text: string };
type Progress = (s: string) => void;
const fail = (s: string): never => {
  throw Error(s);
};
async function pdfResult(pdf: PDFDocument) {
  const bytes = new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' });
  if (bytes.size > 25 * MB) fail('Result exceeds 25 MB. Choose fewer pages.');
  return { bytes, ext: 'pdf' as const, pages: pdf.getPageCount() };
}
async function load(f: File) {
  const p = await PDFDocument.load(await f.arrayBuffer());
  pageRange('', p.getPageCount());
  return p;
}
function check(signal: AbortSignal) {
  if (signal.aborted) throw Error('Operation cancelled.');
}
async function cryptoTool(
  op: Tool,
  file: File,
  password: string,
  signal: AbortSignal,
): Promise<Result> {
  const bytes = await file.arrayBuffer();
  check(signal);
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./security.worker.ts', import.meta.url), { type: 'module' }),
      end = () => {
        w.terminate();
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      },
      stop = () => {
        end();
        reject(Error('Operation cancelled.'));
      },
      timer = setTimeout(() => {
        end();
        reject(Error('This PDF took too long to process.'));
      }, 90000);
    signal.addEventListener('abort', stop);
    w.onmessage = ({ data }) => {
      end();
      if (data.error) reject(Error(data.error));
      else
        resolve({
          ext: 'pdf',
          bytes: new Blob([data.bytes], { type: 'application/pdf' }),
          pages: data.pages,
          locked: op === 'protect',
        });
    };
    w.onerror = () => {
      end();
      reject(Error('The offline PDF security engine could not read this file.'));
    };
    w.postMessage({ op, bytes, password }, [bytes]);
  });
}
function visual(page: PDFPage) {
  const { x, y, width: w, height: h } = page.getCropBox(),
    angle = ((page.getRotation().angle % 360) + 360) % 360;
  return {
    w: angle % 180 ? h : w,
    h: angle % 180 ? w : h,
    angle,
    at: (u: number, v: number) =>
      angle === 90
        ? { x: x + w - v, y: y + u }
        : angle === 180
          ? { x: x + w - u, y: y + h - v }
          : angle === 270
            ? { x: x + v, y: y + h - u }
            : { x: x + u, y: y + v },
  };
}
async function stamp(pdf: PDFDocument, op: Tool, pages: number[], o: Options) {
  let font;
  const sig = op === 'sign' && o.signature ? await pdf.embedPng(o.signature) : null;
  if (op === 'watermark') {
    if (!o.value.trim()) fail('Enter watermark text.');
    const { default: fk } = await import('@pdf-lib/fontkit');
    pdf.registerFontkit(fk);
    font = await pdf.embedFont(await (await fetch('/fonts/document-sans.ttf')).arrayBuffer(), {
      subset: true,
    });
  } else font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const i of pages) {
    const p = pdf.getPage(i),
      v = visual(p);
    if (op === 'sign') {
      if (!sig) throw Error('Draw a signature first.');
      const w = v.w * 0.32,
        h = (w * sig.height) / sig.width;
      p.drawImage(sig, {
        ...v.at(o.position === 'left' ? v.w * 0.05 : v.w * 0.95 - w, v.h * 0.07),
        width: w,
        height: h,
        rotate: degrees(v.angle),
      });
    } else {
      const txt = op === 'watermark' ? o.value.trim() : `${i + 1} / ${pdf.getPageCount()}`,
        size = Math.min(
          op === 'watermark' ? v.w * 0.09 : 12,
          (v.w * 0.82) / Math.max(0.01, font.widthOfTextAtSize(txt, 1)),
        ),
        width = font.widthOfTextAtSize(txt, size);
      p.drawText(txt, {
        ...v.at((v.w - width) / 2, op === 'watermark' ? v.h / 2 : v.h * 0.045),
        font,
        size,
        rotate: degrees(v.angle),
        opacity: op === 'watermark' ? 0.38 : 1,
        color: op === 'watermark' ? rgb(0.57, 0.22, 0.17) : rgb(0.2, 0.2, 0.2),
      });
    }
  }
}
async function structured(
  op: Tool,
  files: File[],
  o: Options,
  progress: Progress,
  signal: AbortSignal,
): Promise<Result> {
  let pdf = await load(files[0]);
  const n = pdf.getPageCount();
  if (op === 'merge') {
    if (files.length < 2) fail('Choose at least two PDFs.');
    const out = await PDFDocument.create();
    for (const [i, f] of files.entries()) {
      check(signal);
      progress(`Merging ${i + 1} of ${files.length}…`);
      const src = i === 0 ? pdf : await load(f);
      if (src.getPageCount() + out.getPageCount() > 1500) fail('Use at most 1,500 output pages.');
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
    }
    return pdfResult(out);
  }
  if (op === 'split') {
    const groups = o.range.trim()
      ? o.range.split(';').map((s) => pageRange(s, n, false))
      : pdf.getPageIndices().map((i) => [i]);
    if (groups.length > 150) fail('Split into at most 150 files per job.');
    const zip: Record<string, Uint8Array> = {};
    let total = 0;
    for (const [i, group] of groups.entries()) {
      check(signal);
      progress(`Writing part ${i + 1} of ${groups.length}…`);
      const dst = await PDFDocument.create();
      for (const p of await dst.copyPages(pdf, group)) dst.addPage(p);
      const b = await dst.save();
      if ((total += b.length) > 25 * MB) fail('Parts exceed the 25 MB output limit.');
      zip[`Part-${String(i + 1).padStart(3, '0')}.pdf`] = b;
    }
    return { ext: 'zip', bytes: new Blob([new Uint8Array(zipSync(zip, { level: 0 }))]) };
  }
  if (op === 'compress') {
    const r = await pdfResult(pdf);
    if (r.bytes.size >= files[0].size)
      fail('The structural rewrite is not smaller. Try image compression. No copy was saved.');
    return r;
  }
  let pages = pageRange(o.range, n, op !== 'remove');
  if (op === 'remove' || op === 'extract') {
    if (op === 'remove') {
      const removed = new Set(pages);
      pages = pdf.getPageIndices().filter((i) => !removed.has(i));
    }
    if (!pages.length) fail('Keep at least one page.');
    const dst = await PDFDocument.create();
    for (const p of await dst.copyPages(pdf, pages)) dst.addPage(p);
    pdf = dst;
  } else if (op === 'rotate') {
    const angle = Number(o.mode || 90);
    if (![90, 180, 270].includes(angle)) fail('Choose a rotation.');
    for (const i of pages) {
      const p = pdf.getPage(i);
      p.setRotation(degrees((p.getRotation().angle + angle) % 360));
    }
  } else if (op === 'crop') {
    const m = Number(o.value);
    if (!Number.isFinite(m) || m <= 0 || m > 144) fail('Enter a margin of 1–144 points.');
    for (const i of pages) {
      const p = pdf.getPage(i),
        c = p.getCropBox();
      if (Math.min(c.width, c.height) <= 2 * m) fail(`Margin is too large for page ${i + 1}.`);
      p.setCropBox(c.x + m, c.y + m, c.width - 2 * m, c.height - 2 * m);
    }
  } else await stamp(pdf, op, pages, o);
  return pdfResult(pdf);
}
async function raster(
  op: Tool,
  docs: PDFDocumentProxy[],
  o: Options,
  progress: Progress,
  signal: AbortSignal,
): Promise<Result> {
  const src = docs[0],
    n = src.numPages,
    pages = pageRange(
      op === 'compare' ? '' : o.range,
      op === 'compare' ? Math.max(n, docs[1].numPages) : n,
    );
  if (pages.length > (op === 'ocr' ? 20 : 100))
    fail(`Select at most ${op === 'ocr' ? 20 : 100} pages for image processing.`);
  if (
    op === 'redact' &&
    o.boxes.some(
      (b) =>
        !Number.isInteger(b.page) ||
        b.page < 0 ||
        b.page >= n ||
        ![b.x, b.y, b.w, b.h].every(Number.isFinite) ||
        b.x < 0 ||
        b.y < 0 ||
        b.w <= 0 ||
        b.h <= 0 ||
        b.x + b.w > 1.000001 ||
        b.y + b.h > 1.000001,
    )
  )
    fail('Invalid redaction selection. Mark the areas again.');
  const out = await PDFDocument.create(),
    zip: Record<string, Uint8Array> = {};
  let total = 0,
    ocr: import('tesseract.js').Worker | undefined,
    font: import('pdf-lib').PDFFont | undefined,
    matches = 0,
    ppt: import('pptxgenjs').default | undefined,
    pw = 0,
    ph = 0;
  try {
    if (op === 'ocr') {
      progress('Loading bundled English OCR…');
      const { createWorker } = await import('tesseract.js');
      ocr = await createWorker('eng', 1, {
        workerPath: new URL('/ocr/worker.js', location.origin).href,
        corePath: new URL('/ocr/core.wasm.js', location.origin).href,
        langPath: new URL('/ocr/', location.origin).href,
        workerBlobURL: false,
        cacheMethod: 'none',
      });
      const { default: fk } = await import('@pdf-lib/fontkit');
      out.registerFontkit(fk);
      font = await out.embedFont(await (await fetch('/fonts/document-sans.ttf')).arrayBuffer(), {
        subset: true,
      });
    }
    if (op === 'toslides') {
      const { default: P } = await import('pptxgenjs');
      ppt = new P();
      ppt.author = 'Ft PDF';
    }
    for (const [k, i] of pages.entries()) {
      check(signal);
      progress(`${op === 'ocr' ? 'Recognizing' : 'Rendering'} page ${k + 1} of ${pages.length}…`);
      const { canvas, w, h } = await render(
        i < n ? src : docs[1],
        i,
        op === 'ocr' ? 2100 : op === 'compress' ? 1100 : 1600,
      );
      const ctx = canvas.getContext('2d')!;
      try {
        if (op === 'compare') {
          const missing = i >= n || i >= docs[1].numPages;
          let resized = false;
          if (!missing) {
            const b = await render(docs[1], i, 1600),
              scaled = document.createElement('canvas');
            resized = Math.abs(b.w - w) > 1 || Math.abs(b.h - h) > 1;
            scaled.width = canvas.width;
            scaled.height = canvas.height;
            const bc = scaled.getContext('2d')!;
            bc.drawImage(b.canvas, 0, 0, scaled.width, scaled.height);
            const a = ctx.getImageData(0, 0, canvas.width, canvas.height),
              pixels = bc.getImageData(0, 0, scaled.width, scaled.height).data;
            for (let j = 0; j < a.data.length; j += 4) {
              const changed =
                Math.max(
                  Math.abs(a.data[j] - pixels[j]),
                  Math.abs(a.data[j + 1] - pixels[j + 1]),
                  Math.abs(a.data[j + 2] - pixels[j + 2]),
                ) > 26;
              const v = 128 + (a.data[j] + a.data[j + 1] + a.data[j + 2]) / 6;
              a.data[j] = changed ? 200 : v;
              a.data[j + 1] = changed ? 56 : v;
              a.data[j + 2] = changed ? 40 : v;
            }
            ctx.putImageData(a, 0, 0);
            b.canvas.width = scaled.width = 0;
          }
          const bmp = await canvasBlob(canvas);
          if ((total += bmp.size) > 24.8 * MB) fail('Comparison exceeds 25 MB.');
          const p = out.addPage([w, h + 32]),
            im = await out.embedJpg(await bmp.arrayBuffer());
          p.drawImage(im, { x: 0, y: 0, width: w, height: h });
          p.drawText(
            `Page ${i + 1}: ${missing ? (i >= n ? 'only in second PDF' : 'only in first PDF') : resized ? 'page size changed; differences in red' : 'visual differences in red'}`,
            { x: 8, y: h + 11, size: Math.min(11, w / 32) },
          );
          continue;
        }
        if (op === 'redact') {
          ctx.fillStyle = '#000';
          for (const r of o.boxes.filter((b) => b.page === i)) {
            if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0)
              fail('Invalid redaction area.');
            const x = Math.floor(r.x * canvas.width),
              y = Math.floor(r.y * canvas.height);
            ctx.fillRect(
              x,
              y,
              Math.ceil((r.x + r.w) * canvas.width) - x + 1,
              Math.ceil((r.y + r.h) * canvas.height) - y + 1,
            );
          }
        }
        const b = await canvasBlob(canvas, op === 'compress' ? 0.58 : 0.89);
        if ((total += b.size) > 24.8 * MB) fail('Result is too large. Choose fewer pages.');
        if (op === 'tojpg') {
          if (pages.length === 1) return { ext: 'jpg', bytes: b };
          zip[`Page-${String(i + 1).padStart(3, '0')}.jpg`] = new Uint8Array(await b.arrayBuffer());
          continue;
        }
        if (ppt) {
          if (!pw) {
            pw = 10;
            ph = Math.max(1, Math.min(30, (10 * h) / w));
            ppt.defineLayout({ name: 'PAGE', width: pw, height: ph });
            ppt.layout = 'PAGE';
          }
          const scale = Math.min(pw / w, ph / h);
          ppt
            .addSlide()
            .addImage({
              data: canvas.toDataURL('image/jpeg', 0.86),
              x: (pw - w * scale) / 2,
              y: (ph - h * scale) / 2,
              w: w * scale,
              h: h * scale,
            });
          continue;
        }
        const page = out.addPage([w, h]);
        page.drawImage(await out.embedJpg(await b.arrayBuffer()), {
          x: 0,
          y: 0,
          width: w,
          height: h,
        });
        if (ocr && font) {
          const res = await ocr.recognize(canvas, {}, { text: true, blocks: true });
          for (const block of res.data.blocks || [])
            for (const para of block.paragraphs)
              for (const line of para.lines) {
                const t = line.text.replace(/\s+/g, ' ').trim();
                if (!t) continue;
                const b = line.bbox,
                  size = Math.max(
                    1,
                    Math.min(
                      ((b.y1 - b.y0) * h) / canvas.height,
                      ((b.x1 - b.x0) * w) /
                        canvas.width /
                        Math.max(0.01, font.widthOfTextAtSize(t, 1)),
                    ),
                  );
                page.drawText(t, {
                  x: (b.x0 * w) / canvas.width,
                  y: h - (b.y1 * h) / canvas.height,
                  size,
                  font,
                  opacity: 0,
                });
                matches++;
              }
        }
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    if (ocr && !matches) fail('No English text was recognized. Try a clearer scan.');
    if (op === 'tojpg')
      return { ext: 'zip', bytes: new Blob([new Uint8Array(zipSync(zip, { level: 0 }))]) };
    if (ppt)
      return {
        ext: 'pptx',
        bytes: new Blob([
          (await ppt.write({ outputType: 'arraybuffer', compression: true })) as ArrayBuffer,
        ]),
      };
    return await pdfResult(out);
  } finally {
    await ocr?.terminate();
  }
}
export async function runTool(
  op: Tool,
  files: File[],
  o: Options,
  progress: Progress,
  signal: AbortSignal,
): Promise<Result> {
  if (
    !files.length ||
    files.some((f) => f.size > 25 * MB) ||
    files.reduce((s, f) => s + f.size, 0) > 90 * MB
  )
    fail('Choose files under 25 MB each (90 MB per job).');
  const first = files[0];
  check(signal);
  if (op === 'protect' || op === 'unlock' || op === 'repair')
    return cryptoTool(op, first, o.value, signal);
  if (op.startsWith('from')) {
    let text: string;
    if (op === 'fromexcel' || op === 'fromslides')
      text = officeText(new Uint8Array(await first.arrayBuffer()), op);
    else {
      const { imported } = await import('../device/formats'),
        v = await imported(first);
      text = v.type === 'txt' ? v.content : plainHTML(v.content);
    }
    if (!text.trim()) fail('No readable text was found.');
    if (text.length > 50000) fail('Use at most 50,000 text characters per conversion.');
    return { text };
  }
  if (op === 'redact' && !o.boxes.length) fail('Mark at least one area on the page preview.');
  if (op === 'compare' && files.length !== 2) fail('Choose exactly two PDFs.');
  if (
    ['tojpg', 'toword', 'toexcel', 'toslides', 'flatten', 'ocr', 'compare', 'redact'].includes(
      op,
    ) ||
    (op === 'compress' && o.mode === 'image')
  ) {
    const docs: PDFDocumentProxy[] = [];
    try {
      for (const f of files) docs.push(await openPdf(f));
      if (op === 'toword' || op === 'toexcel') {
        const indices = pageRange(o.range, docs[0].numPages);
        if (indices.length > 200) fail('Choose at most 200 pages.');
        const sheets: { page: number; rows: string[][] }[] = [];
        let chars = 0;
        for (const i of indices) {
          check(signal);
          progress(`Reading page ${i + 1}…`);
          const rows = await textRows(docs[0], i);
          chars += rows.reduce((s, r) => s + r.join(' ').length, 0);
          if (chars > 1000000) fail('Extract fewer pages at once.');
          sheets.push({ page: i + 1, rows });
        }
        if (!chars) fail('No selectable text. Run OCR PDF first.');
        if (op === 'toexcel') return { ext: 'xlsx', bytes: workbook(sheets) };
        const { encode } = await import('../device/formats'),
          rich = sheets
            .map(
              (s) =>
                `<h2>Page ${s.page}</h2>` +
                s.rows.map((r) => `<p>${escapeXml(r.join(' '))}</p>`).join(''),
            )
            .join('');
        return { ext: 'docx', ...(await encode('docx', first.name, rich)) };
      }
      const r = await raster(op, docs, o, progress, signal);
      if (op === 'compress' && 'bytes' in r && r.bytes.size >= first.size)
        fail('This PDF is already smaller than the compressed copy. No copy was saved.');
      return r;
    } finally {
      for (const d of docs) await d.destroy();
    }
  }
  return structured(op, files, o, progress, signal);
}
