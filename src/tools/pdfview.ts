import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import worker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = worker;
export async function openPdf(file: Blob) {
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: '/pdf-assets/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdf-assets/fonts/',
    isEvalSupported: false,
  });
  try {
    const doc = await task.promise;
    if ((await doc.getPermissions()) !== null) {
      throw Error('Unlock an authorized copy before using this tool.');
    }
    return doc;
  } catch (e) {
    await task.destroy();
    throw e;
  }
}
export async function render(pdf: PDFDocumentProxy, index: number, maxEdge = 1600) {
  const p = await pdf.getPage(index + 1),
    base = p.getViewport({ scale: 1 });
  if (!Number.isFinite(base.width + base.height) || base.width <= 0 || base.height <= 0)
    throw Error('Invalid PDF page dimensions.');
  const scale = Math.min(3, maxEdge / Math.max(base.width, base.height)),
    v = p.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(v.width));
  canvas.height = Math.max(1, Math.round(v.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  await p.render({ canvasContext: ctx, viewport: v, background: 'white' }).promise;
  p.cleanup();
  return { canvas, w: base.width, h: base.height };
}
export async function textRows(pdf: PDFDocumentProxy, n: number) {
  const page = await pdf.getPage(n + 1),
    v = page.getViewport({ scale: 1 }),
    content = await page.getTextContent();
  const items = content.items
    .flatMap((it) => {
      if (!('str' in it) || !it.str.trim()) return [];
      const [x, y] = v.convertToViewportPoint(it.transform[4], it.transform[5]);
      return [{ x, y, w: it.width, h: Math.max(4, it.height || 10), s: it.str }];
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: (typeof items)[] = [];
  for (const it of items) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - it.y) < Math.max(2, Math.min(last[0].h, it.h) * 0.45))
      last.push(it);
    else rows.push([it]);
  }
  page.cleanup();
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    row.forEach((it, i) => {
      const prev = row[i - 1];
      if (!prev || it.x - prev.x - prev.w > Math.max(10, it.h * 0.9)) cells.push(it.s);
      else cells[cells.length - 1] += ' ' + it.s;
    });
    return cells;
  });
}
