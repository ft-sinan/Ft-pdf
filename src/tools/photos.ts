import { imageSize } from 'image-size';
export type Photo = {
  name: string;
  jpeg: Blob;
  width: number;
  height: number;
  thumb: string;
  turn: number;
};
export const MB = 1048576;
export function canvasBlob(c: HTMLCanvasElement, quality = 0.88) {
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))),
      'image/jpeg',
      quality,
    ),
  );
}
export async function preparePhoto(f: File): Promise<Photo> {
  if (f.size > 25 * MB) throw new Error('Use an image under 25 MB.');
  const raw = await f.arrayBuffer();
  let info;
  try {
    info = imageSize(new Uint8Array(raw));
  } catch {
    throw new Error('Choose a JPEG, PNG or WebP image.');
  }
  if (!['jpg', 'png', 'webp'].includes(info.type || ''))
    throw new Error('Choose a JPEG, PNG or WebP image.');
  if (!info.width || !info.height || info.width * info.height > 64e6)
    throw new Error('Image dimensions exceed 64 megapixels.');
  const url = URL.createObjectURL(f),
    img = new Image();
  const c = document.createElement('canvas');
  try {
    img.src = url;
    await img.decode();
    const s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const jpeg = await canvasBlob(c),
      width = c.width,
      height = c.height;
    const t = Math.min(120 / width, 150 / height);
    c.width = Math.max(1, Math.round(t * width));
    c.height = Math.max(1, Math.round(t * height));
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { name: f.name, jpeg, width, height, thumb: c.toDataURL('image/jpeg', 0.65), turn: 0 };
  } finally {
    URL.revokeObjectURL(url);
    img.removeAttribute('src');
    c.width = c.height = 0;
  }
}
export async function photoPdf(photos: Photo[], paper: string, margin: boolean) {
  if (!photos.length || photos.length > 32) throw new Error('Choose 1–32 images.');
  const { PDFDocument, degrees } = await import('pdf-lib'),
    out = await PDFDocument.create();
  for (const p of photos) {
    const img = await out.embedJpg(await p.jpeg.arrayBuffer()),
      rotate = p.turn % 180 !== 0,
      w = rotate ? p.height : p.width,
      h = rotate ? p.width : p.height;
    let [pw, ph] =
      paper === 'original' ? [w * 0.75, h * 0.75] : paper === 'letter' ? [612, 792] : [595, 842];
    if (paper !== 'original' && w > h) [pw, ph] = [ph, pw];
    const m = margin ? Math.min(24, pw / 8, ph / 8) : 0,
      s = Math.min((pw - m * 2) / w, (ph - m * 2) / h),
      page = out.addPage([pw, ph]);
    let x = (pw - w * s) / 2,
      y = (ph - h * s) / 2;
    const angle = (360 - p.turn) % 360;
    if (angle === 90) x += w * s;
    if (angle === 180) {
      x += w * s;
      y += h * s;
    }
    if (angle === 270) y += h * s;
    page.drawImage(img, { x, y, width: p.width * s, height: p.height * s, rotate: degrees(angle) });
  }
  return new Blob([new Uint8Array(await out.save())], { type: 'application/pdf' });
}
