export const catalog = [
  ['photos', 'Images to PDF', 'Create', 'Arrange photos into a single PDF.'],
  ['merge', 'Merge PDFs', 'Organize', 'Combine files in the order you choose.'],
  ['split', 'Split PDF', 'Organize', 'Save separate PDFs in one ZIP.'],
  ['extract', 'Extract & reorder', 'Organize', 'Keep selected pages in the order you enter.'],
  ['remove', 'Remove pages', 'Organize', 'Make a copy without selected pages.'],
  ['rotate', 'Rotate pages', 'Organize', 'Turn all or selected pages.'],
  ['crop', 'Crop margins', 'Organize', 'Trim visible margins. Cropping is not redaction.'],
  [
    'compress',
    'Compress PDF',
    'Optimize',
    'Reduce size with a structural rewrite or smaller page images.',
  ],
  [
    'repair',
    'Repair PDF',
    'Optimize',
    'Try to rebuild a readable PDF with damaged cross-references.',
  ],
  ['flatten', 'Flatten PDF', 'Optimize', 'Render pages into a non-interactive image PDF.'],
  ['ocr', 'OCR PDF', 'Convert', 'Make scans searchable with bundled English OCR.'],
  ['tojpg', 'PDF to JPG', 'Convert', 'Render each selected page as a JPEG.'],
  ['toword', 'PDF to Word', 'Convert', 'Make an editable DOCX from selectable text.'],
  [
    'toexcel',
    'PDF to Excel',
    'Convert',
    'Export positioned text into worksheet cells, one sheet per page.',
  ],
  [
    'toslides',
    'PDF to PowerPoint',
    'Convert',
    'One page image per slide; slide text is not editable.',
  ],
  ['fromword', 'Word to PDF', 'Create', 'Reflow text from DOC or DOCX; not a layout replica.'],
  ['fromexcel', 'Excel to PDF', 'Create', 'Reflow worksheet values from XLSX.'],
  ['fromslides', 'PowerPoint to PDF', 'Create', 'Reflow slide text from PPTX.'],
  [
    'fromhtml',
    'HTML / TXT to PDF',
    'Create',
    'Typeset local text; no scripts, URLs or external resources.',
  ],
  ['watermark', 'Watermark PDF', 'Mark up', 'Stamp text onto selected pages.'],
  ['numbers', 'Page numbers', 'Mark up', 'Number the selected pages.'],
  ['sign', 'Sign visually', 'Mark up', 'Place your handwritten mark. Not a certificate signature.'],
  ['redact', 'Redact PDF', 'Privacy', 'Permanently erase marked areas in a new rasterized copy.'],
  ['protect', 'Protect PDF', 'Privacy', 'Encrypt a new copy with an opening password.'],
  ['unlock', 'Unlock PDF', 'Privacy', 'Remove protection using a valid authorized password.'],
  ['compare', 'Compare PDFs', 'Review', 'Highlight visible page differences in a new PDF.'],
] as const;
export type Tool = (typeof catalog)[number][0];
export const descriptions = Object.fromEntries(
  catalog.map((t) => [t[0], { name: t[1], group: t[2], detail: t[3] }]),
) as Record<Tool, { name: string; group: string; detail: string }>;
export function accepts(t: Tool) {
  return t === 'fromword'
    ? '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : t === 'fromexcel'
      ? '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : t === 'fromslides'
        ? '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : t === 'fromhtml'
          ? '.html,.htm,.txt,text/html,text/plain'
          : 'application/pdf,.pdf';
}
export function matching(t: Tool, name: string) {
  return (
    t === 'fromword'
      ? /\.docx?$/i
      : t === 'fromexcel'
        ? /\.xlsx$/i
        : t === 'fromslides'
          ? /\.pptx$/i
          : t === 'fromhtml'
            ? /\.(html?|txt)$/i
            : /\.pdf$/i
  ).test(name);
}
export const multiple = (t: Tool) => t === 'merge' || t === 'compare';
export const ranged = (t: Tool) =>
  (
    [
      'extract',
      'remove',
      'rotate',
      'numbers',
      'crop',
      'sign',
      'watermark',
      'tojpg',
      'toword',
      'toslides',
      'toexcel',
      'ocr',
    ] as Tool[]
  ).includes(t);
