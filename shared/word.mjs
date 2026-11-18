import {
  Document,
  HeadingLevel,
  Paragraph,
  TextRun,
  Table,
  TableCell,
  TableRow,
  WidthType,
  ImageRun,
  ExternalHyperlink,
} from 'docx';
import { Buffer } from 'buffer';
import { parseDocument } from 'htmlparser2';
import { imageSize } from 'image-size';
export const embeddedImage = /^data:image\/(?:png|jpeg|gif);base64,[a-zA-Z0-9+/=\s]+$/;
function runs(node, style = {}) {
  if (node.type === 'text') return [new TextRun({ text: node.data, ...style })];
  if (node.name === 'br') return [new TextRun({ break: 1 })];
  if (node.name === 'img' && embeddedImage.test(node.attribs?.src || '')) {
    try {
      const data = Buffer.from(node.attribs.src.split(',')[1], 'base64'),
        info = imageSize(data);
      if (!info.width || !info.height || !['png', 'jpg', 'gif'].includes(info.type)) return [];
      const scale = Math.min(1, 612 / info.width, 780 / info.height);
      return [
        new ImageRun({
          type: info.type,
          data,
          transformation: {
            width: Math.max(1, Math.round(info.width * scale)),
            height: Math.max(1, Math.round(info.height * scale)),
          },
          altText: {
            title: node.attribs.alt || 'Image',
            name: node.attribs.alt || 'Document image',
            description: '',
          },
        }),
      ];
    } catch {
      return [];
    }
  }
  if (node.name === 'a' && node.attribs?.href && /^(https?:|mailto:)/i.test(node.attribs.href))
    return [
      new ExternalHyperlink({
        link: node.attribs.href,
        children: (node.children || []).flatMap((n) => runs(n, { ...style, underline: {} })),
      }),
    ];
  const extra = { ...style };
  if (['b', 'strong'].includes(node.name)) extra.bold = true;
  if (['i', 'em'].includes(node.name)) extra.italics = true;
  if (node.name === 'u') extra.underline = {};
  if (['s', 'del'].includes(node.name)) extra.strike = true;
  return (node.children || []).flatMap((n) => runs(n, extra));
}
export function wordDocument(html, title) {
  const paragraphs = [];
  let inline = [];
  const flush = () => {
    if (inline.length) {
      paragraphs.push(new Paragraph({ children: inline }));
      inline = [];
    }
  };
  function block(node, list) {
    const name = node.name || '';
    if (name === 'table') {
      flush();
      const rows = [];
      function visit(nodes) {
        for (const n of nodes) {
          if (n.name === 'tr') {
            const children = n.children
              .filter((cell) => ['td', 'th'].includes(cell.name))
              .map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: runs(cell, cell.name === 'th' ? { bold: true } : {}),
                      }),
                    ],
                  }),
              );
            if (children.length) rows.push(new TableRow({ children }));
          } else if (n.children) visit(n.children);
        }
      }
      visit(node.children || []);
      if (rows.length)
        paragraphs.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      return;
    }
    if (['ul', 'ol', 'thead', 'tbody', 'tr'].includes(name)) {
      flush();
      (node.children || []).forEach((n, i) =>
        block(n, name === 'ul' ? '• ' : name === 'ol' ? `${i + 1}. ` : undefined),
      );
      return;
    }
    if (['p', 'div', 'h1', 'h2', 'h3', 'li', 'blockquote', 'td', 'th'].includes(name)) {
      flush();
      const heading = {
        h1: HeadingLevel.HEADING_1,
        h2: HeadingLevel.HEADING_2,
        h3: HeadingLevel.HEADING_3,
      }[name];
      paragraphs.push(
        new Paragraph({ heading, children: [...(list ? [new TextRun(list)] : []), ...runs(node)] }),
      );
      return;
    }
    inline.push(...runs(node));
  }
  parseDocument(html).children.forEach((n) => block(n));
  flush();
  return new Document({
    creator: 'Ft PDF',
    title,
    sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph('')] }],
  });
}
