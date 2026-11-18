import { PDFDocument } from 'pdf-lib';
import { Packer } from 'docx';
import { wordDocument, embeddedImage } from '../shared/word.mjs';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import sanitizeHtml from 'sanitize-html';
import yauzl from 'yauzl';

export const TYPES = ['pdf', 'docx', 'txt', 'html'];
export const MAX_FILE = 25 * 1024 * 1024;
export const QUOTA = 100 * 1024 * 1024;
export const fail = (status, message) => Object.assign(new Error(message), { status });
export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const cleanRich = (s) =>
  sanitizeHtml(s, {
    allowedTags: [
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
    allowedAttributes: { img: ['src', 'alt'], a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    exclusiveFilter: (frame) => frame.tag === 'img' && !embeddedImage.test(frame.attribs.src || ''),
  });
// Inspect the ZIP directory before loading Word parts into memory.
async function validateWordArchive(buffer) {
  await new Promise((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      let total = 0,
        count = 0,
        found = false;
      zip.on('error', reject);
      zip.on('end', () => (found ? resolve() : reject(new Error('Missing Word content.'))));
      zip.on('entry', (entry) => {
        total += entry.uncompressedSize;
        count++;
        if (
          count > 5000 ||
          total > 100 * 1024 * 1024 ||
          entry.uncompressedSize > 40 * 1024 * 1024
        ) {
          zip.close();
          reject(new Error('Word archive is too large when expanded.'));
          return;
        }
        if (entry.fileName === 'word/document.xml') found = true;
        zip.readEntry();
      });
      zip.readEntry();
    }),
  );
}
export function titleOf(value, type) {
  if (typeof value !== 'string') throw fail(400, 'Give your document a name.');
  const name = value
    .replace(/[\\/\x00-\x1f\x7f]/g, ' ')
    .trim()
    .replace(new RegExp(`\\.${type}$`, 'i'), '')
    .trim();
  if (!name || name.length > 140)
    throw fail(400, 'Use a document name between 1 and 140 characters.');
  return name;
}
export function wordFile(html, title) {
  return Packer.toBuffer(wordDocument(html, title));
}
export async function makePdf(title) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('Ft PDF');
  pdf.addPage([595, 842]);
  return Buffer.from(await pdf.save());
}
export async function pdfInfo(bytes) {
  try {
    const p = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { pages: p.isEncrypted ? null : p.getPageCount(), locked: p.isEncrypted };
  } catch {
    throw fail(400, 'This file is not a readable PDF. Try exporting a fresh copy.');
  }
}
export async function fromContent(type, title, input) {
  if (typeof input !== 'string') throw fail(400, 'Document content must be text.');
  const content = type === 'docx' ? cleanRich(input) : input;
  const bytes = type === 'docx' ? await wordFile(content, title) : Buffer.from(content, 'utf8');
  return { content, bytes };
}
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  return new TextDecoder().decode(buf);
}
export async function importFile(name, bytes) {
  let ext = name.split('.').pop().toLowerCase();
  if (ext === 'htm') ext = 'html';
  if (![...TYPES, 'doc'].includes(ext))
    throw fail(415, 'Choose a PDF, DOCX, DOC, TXT, or HTML file.');
  const title = titleOf(name.replace(/\.[^.]+$/, ''), ext);
  if (ext === 'pdf')
    return { name: title, type: ext, bytes, content: '', ...(await pdfInfo(bytes)) };
  if (ext === 'docx') {
    try {
      await validateWordArchive(bytes);
      const { value } = await mammoth.convertToHtml(
        { buffer: bytes },
        {
          externalFileAccess: false,
          convertImage: mammoth.images.imgElement(async (image) => ({
            src: ['image/jpeg', 'image/png', 'image/gif'].includes(image.contentType)
              ? `data:${image.contentType};base64,${await image.read('base64')}`
              : '',
          })),
        },
      );
      return { name: title, type: ext, bytes, content: cleanRich(value) };
    } catch {
      throw fail(400, 'This Word file could not be opened. Check that it is an unprotected DOCX.');
    }
  }
  if (ext === 'doc') {
    try {
      const text = (await new WordExtractor().extract(bytes)).getBody();
      const html = text
        .split(/\r?\n/)
        .map((p) => `<p>${escape(p)}</p>`)
        .join('');
      return { name: title, type: 'docx', ...(await fromContent('docx', title, html)) };
    } catch {
      throw fail(
        400,
        'This legacy Word file could not be converted. Save it as DOCX and try again.',
      );
    }
  }
  return { name: title, type: ext, bytes, content: decodeText(bytes) };
}
