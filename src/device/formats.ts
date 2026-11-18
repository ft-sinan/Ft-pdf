import DOMPurify from 'dompurify';
import type { Kind } from '../types';
export type Encoded = { bytes: Blob; content: string; pages?: number | null; locked?: boolean };
const max = 25 * 1048576;
function codec<T>(data: object, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./codec.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(
      () => finish(() => reject(new Error('This Word document took too long to convert.'))),
      60000,
    );
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      worker.terminate();
      fn();
    };
    worker.onmessage = ({ data }) =>
      finish(() => (data.error ? reject(new Error(data.error)) : resolve(data)));
    worker.onerror = () => finish(() => reject(new Error('Could not run the Word converter.')));
    worker.postMessage(data, transfer);
  });
}
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (
    node.nodeName === 'IMG' &&
    !/^data:image\/(?:png|jpeg|gif);base64,[a-z\d+/=\s]+$/i.test(node.getAttribute('src') || '')
  )
    node.removeAttribute('src');
  if (node.nodeName === 'A' && !/^(https?:|mailto:)/i.test(node.getAttribute('href') || ''))
    node.removeAttribute('href');
});
const clean = (html: string) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'div',
      'br',
      'b',
      'strong',
      'i',
      'em',
      'u',
      'h1',
      'h2',
      'h3',
      'ul',
      'ol',
      'li',
      'blockquote',
      's',
      'del',
      'sub',
      'sup',
      'table',
      'tr',
      'td',
      'th',
      'tbody',
      'thead',
      'img',
      'a',
    ],
    ALLOWED_ATTR: ['src', 'alt', 'href'],
    ALLOW_DATA_ATTR: false,
  });
export async function pdfInfo(blob: Blob) {
  if (blob.size > max) throw new Error('Files must be 25 MB or smaller.');
  try {
    const { PDFDocument } = await import('pdf-lib');
    const p = await PDFDocument.load(await blob.arrayBuffer(), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return { pages: p.isEncrypted ? null : p.getPageCount(), locked: p.isEncrypted };
  } catch {
    throw new Error('Could not open this PDF. Check that it is a readable PDF file.');
  }
}
export async function encode(type: Kind, name: string, input: string): Promise<Encoded> {
  if (type === 'docx') {
    const content = clean(input),
      { bytes } = await codec<{ bytes: ArrayBuffer }>({ action: 'write', html: content, name });
    return { bytes: new Blob([bytes]), content };
  }
  return { bytes: new Blob([input]), content: input };
}
export async function imported(file: File): Promise<Encoded & { type: Kind; name: string }> {
  if (file.size > max) throw new Error('Files must be 25 MB or smaller.');
  let type = file.name.split('.').pop()?.toLowerCase();
  if (type === 'htm') type = 'html';
  const name = file.name.replace(/\.[^.]+$/, '');
  if (type === 'pdf') return { type, name, bytes: file, content: '', ...(await pdfInfo(file)) };
  if (type === 'doc' || type === 'docx') {
    const bytes = await file.arrayBuffer();
    try {
      const { html } = await codec<{ html: string }>({ action: 'read', kind: type, bytes }, [
        bytes,
      ]);
      const content = clean(html);
      if (type === 'doc') return { type: 'docx', name, ...(await encode('docx', name, content)) };
      return { type, name, bytes: file, content };
    } catch (e) {
      throw new Error(
        'Unable to read this Word document. ' + (e instanceof Error ? e.message : ''),
      );
    }
  }
  if (type !== 'txt' && type !== 'html')
    throw new Error('Choose a PDF, DOC, DOCX, TXT or HTML file.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? 'utf-16le'
      : bytes[0] === 254 && bytes[1] === 255
        ? 'utf-16be'
        : 'utf-8';
  return { type, name, bytes: file, content: new TextDecoder(encoding).decode(bytes) };
}
