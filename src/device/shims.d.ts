declare module 'mammoth/mammoth.browser.min.js' {
  const mammoth: typeof import('mammoth');
  export default mammoth;
}
declare module 'word-extractor/lib/buffer-reader.js' {
  import type { Buffer } from 'buffer';
  export default class BufferReader {
    constructor(b: Buffer);
  }
}
declare module 'word-extractor/lib/word-ole-extractor.js' {
  import type BufferReader from 'word-extractor/lib/buffer-reader.js';
  export default class Extractor {
    extract(r: BufferReader): Promise<{ getBody(): string }>;
  }
}
declare module 'process/browser' {
  const process: object;
  export default process;
}
