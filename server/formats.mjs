import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
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
const color = (hex) => rgb(...[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
export async function makePdf(title, template = 'blank') {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('Ft PDF');
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold),
    normal = await pdf.embedFont(StandardFonts.Helvetica);
  if (template === 'blank') {
    pdf.addPage([595, 842]);
    return Buffer.from(await pdf.save());
  }
  const page = pdf.addPage([595, 842]);
  const ink = color('322e29'),
    red = color('ad4839');
  const text = (s, x, y, size, font = normal, c = ink) =>
    page.drawText(s, { x, y, size, font, color: c });
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 595,
    height: 842,
    color: color(template === 'report' ? 'faeee3' : 'f8f4ea'),
  });
  text('FIELDNOTES   /   STUDIO', 46, 779, 10, bold);
  text('DOCUMENT SERIES    01', 386, 779, 9);
  page.drawLine({ start: { x: 46, y: 757 }, end: { x: 549, y: 757 }, color: ink, thickness: 1 });
  const lines =
    template === 'brand'
      ? ['Studio brand', 'guidelines.']
      : template === 'report'
        ? ['Quarterly', 'strategy report.']
        : [title.replace(/[^\x20-\x7e]/g, '').slice(0, 32)];
  lines.forEach((line, i) => text(line, 42, 646 - i * 57, line.length > 22 ? 34 : 55, bold));
  text(
    template === 'brand'
      ? 'Identity, typography, and visual direction'
      : template === 'travel'
        ? 'A long weekend in Wayanad'
        : template === 'brief'
          ? 'Fieldnotes identity project / Creative direction'
          : 'Research, observations, and next steps',
    47,
    521,
    15,
  );
  if (template === 'report') {
    [80, 120, 99, 168, 194, 235, 264].forEach((h, i) =>
      page.drawRectangle({
        x: 47 + i * 72,
        y: 128,
        width: 47,
        height: h,
        color: i % 2 ? red : color('d78468'),
      }),
    );
  } else {
    for (let i = 0; i < 6; i++)
      page.drawCircle({ x: 165 + i * 54, y: 277, size: 92, color: i % 2 ? color('d49070') : red });
  }
  text('DESIGN STUDIO', 47, 52, 10, bold);
  text('01  /  03', 498, 52, 10);
  const sections =
    template === 'travel'
      ? [
          [
            'Friday / Arrival',
            'Travel to Kalpetta and check in before the afternoon rain. Keep the evening free for a walk through town and dinner nearby.',
            'Pack a light rain jacket, walking shoes, a notebook, and a refillable water bottle.',
          ],
          [
            'Saturday / Field notes',
            'Spend the morning exploring the tea estates with a local guide. Stop for lunch and leave the afternoon open for sketching and photography.',
            'On Sunday, check out after breakfast and allow extra time for the return journey.',
          ],
        ]
      : template === 'brief'
        ? [
            [
              'Project context',
              'Fieldnotes needs a flexible identity for its quarterly publications, studio correspondence, and digital portfolio.',
              'The audience values clear writing and considered design. The identity should feel approachable, editorial, and grounded.',
            ],
            [
              'Deliverables',
              'Develop a primary mark, a compact color palette, a typography system, and sample layouts for print and screen.',
              'Review the first concepts at the next studio meeting and choose one direction for refinement.',
            ],
          ]
        : template === 'brand'
          ? [
              [
                'Our identity',
                'We make room for clear ideas. The studio identity is built around warm paper, confident typography, and a single expressive accent.',
                'Use the primary mark on a quiet background. Give it generous space and keep the original proportions.',
              ],
              [
                'Color and typography',
                'Our core palette pairs terracotta with cream and charcoal. Reserve the strongest color for a single point of emphasis.',
                'Use a strong heading, a short introduction, and a generous line height for every editorial layout.',
              ],
            ]
          : [
              [
                'Key findings',
                'The strongest results came from focused projects with a clear audience and measurable goals.',
                'The next quarter prioritizes client onboarding, the studio website, and a more consistent publishing rhythm.',
              ],
              [
                'Next steps',
                'Review the findings with the team and choose three practical changes to test this month.',
                'Schedule a follow-up review and capture the results in the shared project notes.',
              ],
            ];
  sections.forEach(([h, ...ps], i) => {
    const p = pdf.addPage([595, 842]);
    p.drawText('FIELDNOTES   /   STUDIO', { x: 48, y: 780, font: bold, size: 10, color: red });
    p.drawText(h, { x: 48, y: 698, font: bold, size: 34, color: ink });
    ps.forEach((s, j) =>
      p.drawText(s, {
        x: 48,
        y: 628 - j * 112,
        font: normal,
        size: 15,
        maxWidth: 494,
        lineHeight: 23,
        color: ink,
      }),
    );
    p.drawText(`0${i + 2}  /  03`, { x: 485, y: 50, size: 11, font: normal, color: ink });
  });
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
