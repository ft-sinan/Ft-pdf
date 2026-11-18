import type { Page } from 'tesseract.js';

/** Own the pinned Tesseract 6 worker so Stop, engine errors and deadlines also work
 * during WASM/model initialization. No worker URLs, imports or languages come from input. */
export class OfflineOCR {
  private worker: Worker;
  private seq = 0;
  constructor(private signal: AbortSignal) {
    this.worker = new Worker('/ocr/worker.js');
  }
  private step<T>(action: string, payload: object, transfer: Transferable[] = []): Promise<T> {
    if (this.signal.aborted) return Promise.reject(new Error('Operation cancelled.'));
    const jobId = String(++this.seq);
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timeout);
        this.signal.removeEventListener('abort', stop);
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.onmessageerror = null;
      };
      const fail = (why: string) => {
        done();
        reject(new Error(why));
      };
      const stop = () => fail('Operation cancelled.');
      const timeout = window.setTimeout(
        () => fail(`Offline OCR timed out during ${action}. Try a smaller or clearer scan.`),
        90000,
      );
      this.signal.addEventListener('abort', stop, { once: true });
      this.worker.onerror = (e) => {
        e.preventDefault();
        fail('Offline OCR could not start: ' + (e.message || 'worker error'));
      };
      this.worker.onmessageerror = () => fail('Could not read the OCR result.');
      this.worker.onmessage = ({ data }) => {
        if (data.jobId !== jobId || data.status === 'progress') return;
        if (data.status === 'resolve') {
          done();
          resolve(data.data);
        } else fail('Offline OCR: ' + String(data.data).slice(0, 250));
      };
      try {
        this.worker.postMessage({ workerId: 'english', jobId, action, payload }, transfer);
      } catch {
        fail('Could not send data to offline OCR.');
      }
    });
  }
  async initialize() {
    // The worker includes the WASM glue and binary. Supply the model as bytes so
    // the worker never has to fetch from a document provider or a CDN.
    await this.step('load', { options: { lstmOnly: true, corePath: '/ocr/worker.js' } });
    const r = await fetch('/ocr/eng.traineddata.gz', { signal: this.signal });
    if (!r.ok) throw Error('The bundled English language model is unavailable.');
    const bytes = await r.arrayBuffer();
    await this.step(
      'loadLanguage',
      {
        langs: [{ code: 'eng', data: new Uint8Array(bytes) }],
        options: { cacheMethod: 'none', gzip: true, lstmOnly: true },
      },
      [bytes],
    );
    await this.step('initialize', { langs: 'eng', oem: 1, config: {} });
  }
  async recognize(image: Blob) {
    const bytes = await image.arrayBuffer();
    return this.step<Page>(
      'recognize',
      { image: new Uint8Array(bytes), options: {}, output: { text: true, blocks: true } },
      [bytes],
    );
  }
  terminate() {
    this.worker.terminate();
  }
}
