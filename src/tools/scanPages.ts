import { canvasBlob, type Photo } from './photos';
import { project, validQuad, type Point, type Quad } from './pageDetection';
export type ScanPage = Photo & { source: Blob; quad: Quad };
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export async function straighten(source: Blob, quad: Quad, name: string): Promise<ScanPage> {
  if (!validQuad(quad))
    throw Error('Keep the four corners around a single page, without crossing edges.');
  const img = await createImageBitmap(source),
    sw = img.width,
    sh = img.height,
    src = canvas(sw, sh),
    ctx = src.getContext('2d')!;
  let input: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, 0);
    input = ctx.getImageData(0, 0, sw, sh).data;
  } finally {
    img.close();
    src.width = src.height = 0;
  }
  const dist = (a: Point, b: Point) => Math.hypot((a.x - b.x) * sw, (a.y - b.y) * sh),
    [a, b, c, d] = quad,
    dw = Math.max(dist(a, b), dist(c, d)),
    dh = Math.max(dist(a, d), dist(b, c)),
    scale = Math.min(1, 2000 / Math.max(dw, dh)),
    out = canvas(dw * scale, dh * scale),
    w = out.width,
    h = out.height,
    k = out.getContext('2d')!,
    pixels = k.createImageData(w, h),
    dest = pixels.data,
    m = project(quad);
  try {
    // Inverse perspective mapping with bilinear sampling. All pixels come from the original shot.
    for (let y = 0, p = 0; y < h; y++) {
      const v = (y + 0.5) / h,
        ax = m[1] * v + m[2],
        ay = m[4] * v + m[5],
        az = m[7] * v + 1;
      for (let x = 0; x < w; x++, p += 4) {
        const u = (x + 0.5) / w,
          z = 1 / (m[6] * u + az),
          sx = Math.max(0, Math.min(sw - 1, (m[0] * u + ax) * z * (sw - 1))),
          sy = Math.max(0, Math.min(sh - 1, (m[3] * u + ay) * z * (sh - 1))),
          x0 = Math.floor(sx),
          y0 = Math.floor(sy),
          fx = sx - x0,
          fy = sy - y0,
          i = 4 * (y0 * sw + x0),
          j = x0 + 1 < sw ? i + 4 : i,
          l = y0 + 1 < sh ? 4 * sw : 0;
        for (let ch = 0; ch < 3; ch++)
          dest[p + ch] =
            (input[i + ch] * (1 - fx) + input[j + ch] * fx) * (1 - fy) +
            (input[i + l + ch] * (1 - fx) + input[j + l + ch] * fx) * fy;
        dest[p + 3] = 255;
      }
    }
    k.putImageData(pixels, 0, 0);
    const jpeg = await canvasBlob(out, 0.89),
      r = Math.min(1, 150 / Math.max(w, h)),
      thumb = canvas(w * r, h * r);
    thumb.getContext('2d')!.drawImage(out, 0, 0, thumb.width, thumb.height);
    return {
      source,
      quad,
      jpeg,
      name,
      width: w,
      height: h,
      turn: 0,
      thumb: thumb.toDataURL('image/jpeg', 0.78),
    };
  } finally {
    out.width = out.height = 0;
  }
}
export async function snapshot(video: HTMLVideoElement) {
  const w = video.videoWidth,
    h = video.videoHeight;
  if (!w || !h || video.readyState < 2) throw Error('Wait for the camera preview.');
  const r = Math.min(1, 2000 / Math.max(w, h)),
    c = canvas(w * r, h * r);
  try {
    c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
    return await canvasBlob(c, 0.94);
  } finally {
    c.width = c.height = 0;
  }
}
export async function insertAfter(original: Blob, addition: Blob, page: number) {
  const { PDFDocument } = await import('pdf-lib'),
    out = await PDFDocument.load(await original.arrayBuffer()),
    extra = await PDFDocument.load(await addition.arrayBuffer());
  if (page < 1 || page > out.getPageCount()) throw Error('Select an existing page first.');
  const pages = await out.copyPages(extra, extra.getPageIndices());
  pages.forEach((p, i) => out.insertPage(page + i, p));
  const bytes = new Uint8Array(await out.save());
  if (bytes.byteLength > 25 * 1048576)
    throw Error('The combined PDF exceeds 25 MB. Insert fewer pages.');
  return new Blob([bytes], { type: 'application/pdf' });
}
