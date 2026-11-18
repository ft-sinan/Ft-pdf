import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { parseDocument } from 'htmlparser2';
import type { AnyNode } from 'domhandler';
export const escapeXml = (s: string) =>
  s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const col = (n: number): string =>
  (n >= 26 ? col(Math.floor(n / 26) - 1) : '') + String.fromCharCode(65 + (n % 26));
export function workbook(sheets: { page: number; rows: string[][] }[]) {
  const files: Record<string, Uint8Array> = {},
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    pkg = 'http://schemas.openxmlformats.org/package/2006/relationships',
    put = (k: string, x: string) =>
      (files[k] = strToU8('<?xml version="1.0" encoding="UTF-8"?>' + x));
  put(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  );
  put(
    '_rels/.rels',
    `<Relationships xmlns="${pkg}"><Relationship Id="r1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  put(
    'xl/workbook.xml',
    `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets.map((s, i) => `<sheet name="Page ${s.page}" sheetId="${i + 1}" r:id="r${i + 1}"/>`).join('')}</sheets></workbook>`,
  );
  put(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="${pkg}">${sheets.map((_, i) => `<Relationship Id="r${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  );
  sheets.forEach((s, i) =>
    put(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet xmlns="${ns}"><sheetData>${s.rows.map((r, j) => `<row r="${j + 1}">${r.map((v, k) => `<c r="${col(k)}${j + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`,
    ),
  );
  return new Blob([new Uint8Array(zipSync(files, { level: 4 }))]);
}
function xml(raw: Uint8Array) {
  const s = strFromU8(raw);
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw Error('Unsupported document XML.');
  const doc = new DOMParser().parseFromString(s, 'application/xml');
  if (doc.querySelector('parsererror')) throw Error('Invalid document XML.');
  return doc;
}
const tags = (el: Document | Element, name: string) =>
  Array.from(el.getElementsByTagNameNS('*', name));
export function officeText(bytes: Uint8Array, kind: 'fromslides' | 'fromexcel') {
  let seen = 0,
    total = 0;
  const sheets = kind === 'fromexcel',
    match = sheets
      ? /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/
      : /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml)$/;
  const entries = unzipSync(bytes, {
    filter: (e) => {
      if (++seen > 6000 || (total += e.originalSize) > 80 * 1048576)
        throw Error('Office archive is too large.');
      if (!match.test(e.name)) return false;
      if (e.originalSize > 10 * 1048576) throw Error('A sheet or slide is too large.');
      return true;
    },
  });
  const base = sheets ? 'xl' : 'ppt',
    main = sheets ? 'workbook' : 'presentation',
    root = entries[`${base}/${main}.xml`],
    rels = entries[`${base}/_rels/${main}.xml.rels`];
  if (!root || !rels) throw Error('Not a supported Office document.');
  const links = new Map(
    tags(xml(rels), 'Relationship')
      .filter((e) => e.getAttribute('TargetMode') !== 'External')
      .map((e) => [e.getAttribute('Id'), e.getAttribute('Target')]),
  );
  const strings = entries['xl/sharedStrings.xml']
    ? tags(xml(entries['xl/sharedStrings.xml']), 'si').map((e) =>
        tags(e, 't')
          .map((t) => t.textContent)
          .join(''),
      )
    : [];
  const parts: string[] = [];
  let chars = 0,
    hasText = false;
  for (const [i, item] of tags(xml(root), sheets ? 'sheet' : 'sldId').entries()) {
    const path = links.get(
      item.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      ),
    );
    if (!path) continue;
    const raw = entries[path.startsWith('/') ? path.slice(1) : `${base}/${path}`];
    if (!raw) continue;
    const doc = xml(raw);
    const lines = sheets
      ? tags(doc, 'row').map((r) =>
          tags(r, 'c')
            .map((c) => {
              const t = c.getAttribute('t'),
                v = tags(c, 'v')[0]?.textContent || '';
              return t === 's'
                ? strings[Number(v)] || ''
                : t === 'inlineStr'
                  ? tags(c, 't')
                      .map((e) => e.textContent)
                      .join('')
                  : t === 'b'
                    ? v === '1'
                      ? 'TRUE'
                      : 'FALSE'
                    : v;
            })
            .join('   |   '),
        )
      : tags(doc, 'p').map((p) =>
          tags(p, 't')
            .map((e) => e.textContent)
            .join(''),
        );
    if (lines.some((line) => line.replace(/[|\s]/g, '').length)) hasText = true;
    const text =
      (sheets ? item.getAttribute('name') || `Sheet ${i + 1}` : `Slide ${i + 1}`) +
      '\n' +
      lines.join('\n');
    if ((chars += text.length) > 50000)
      throw Error('Use a document with up to 50,000 text characters.');
    parts.push(text);
  }
  if (!parts.length || !hasText)
    throw Error(
      'No readable slide text or worksheet values. Image-only pages cannot be converted as text.',
    );
  return parts.join('\n\n');
}
export function plainHTML(html: string) {
  const render = (n: AnyNode): string => {
    if (n.type === 'text') return n.data;
    if (!('children' in n)) return '';
    const tag = 'name' in n ? n.name : '';
    if (['script', 'style', 'head', 'iframe', 'object', 'template'].includes(tag)) return '';
    if (tag === 'br') return '\n';
    const t = n.children.map(render).join('');
    return ['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'section', 'article', 'blockquote'].includes(
      tag,
    )
      ? '\n' + t + '\n'
      : tag === 'td' || tag === 'th'
        ? t + '  '
        : t;
  };
  return render(parseDocument(html))
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
    .trim();
}
