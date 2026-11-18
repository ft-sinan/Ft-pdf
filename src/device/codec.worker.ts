// Isolate potentially expensive Office parsing from the UI and the native data store.
import { Buffer } from 'buffer';
import process from 'process/browser';
import { unzipSync } from 'fflate';
Object.assign(globalThis, { Buffer, process });
self.onmessage = async ({ data }) => {
  try {
    if (data.action === 'write') {
      const [{ wordDocument }, { Packer }] = await Promise.all([
        import('../../shared/word.mjs'),
        import('docx'),
      ]);
      const bytes = await Packer.toArrayBuffer(wordDocument(data.html, data.name));
      self.postMessage({ bytes }, { transfer: [bytes] });
      return;
    }
    const bytes = new Uint8Array(data.bytes as ArrayBuffer);
    if (data.kind === 'doc') {
      if (bytes.length < 512 || bytes[0] !== 0xd0 || bytes[1] !== 0xcf)
        throw new Error('Not a binary Word document.');
      const [{ default: Reader }, { default: Extractor }] = await Promise.all([
        import('word-extractor/lib/buffer-reader.js'),
        import('word-extractor/lib/word-ole-extractor.js'),
      ]);
      const text = (await new Extractor().extract(new Reader(Buffer.from(bytes)))).getBody();
      self.postMessage({
        html: text
          .split(/\r?\n/)
          .map(
            (p) =>
              '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>',
          )
          .join(''),
      });
      return;
    }
    let files = 0,
      size = 0,
      valid = false;
    unzipSync(bytes, {
      filter: (e) => {
        size += e.originalSize;
        if (++files > 5000 || e.originalSize > 40 * 1048576 || size > 100 * 1048576)
          throw new Error('Word archive is too large.');
        if (e.name === 'word/document.xml') valid = true;
        return false;
      },
    });
    if (!valid) throw new Error('Not a Word document.');
    const { default: mammoth } = await import('mammoth/mammoth.browser.min.js');
    const { value } = await mammoth.convertToHtml(
      { arrayBuffer: data.bytes },
      {
        convertImage: mammoth.images.imgElement(async (image) => ({
          src: ['image/png', 'image/jpeg', 'image/gif'].includes(image.contentType)
            ? `data:${image.contentType};base64,${await image.read('base64')}`
            : '',
        })),
      },
    );
    self.postMessage({ html: value });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : 'Word conversion failed.' });
  }
};
