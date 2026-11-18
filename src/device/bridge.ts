/** Small control messages only. Private reads stream by ID; writes are bounded chunks. */
type Handler = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: number;
};
type DevicePort = {
  postMessage: (s: string) => void;
  onmessage: ((e: MessageEvent<string>) => void) | null;
};
let port: DevicePort | undefined,
  seq = 0;
const pending = new Map<string, Handler>();
export function rpc<T>(op: string, args: object = {}): Promise<T> {
  if (!port) {
    port = (window as unknown as { FtDevice?: DevicePort }).FtDevice;
    if (!port)
      return Promise.reject(
        new Error('The on-device library is unavailable. Please reopen Ft PDF.'),
      );
    port.onmessage = (e) => {
      const m = JSON.parse(e.data),
        p = pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error || 'The library could not complete this action.'));
    };
  }
  const channel = port,
    id = String(++seq);
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error('The device library did not respond. Please try again.'));
    }, 90000);
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    try {
      channel.postMessage(JSON.stringify({ id, op, args }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}
export async function privateRead(path: string, signal?: AbortSignal) {
  const r = await fetch(path, { headers: { 'X-Ft-Read': '1' }, signal, cache: 'no-store' });
  if (!r.ok) throw new Error('This file is unavailable in the current library.');
  return r;
}
const base64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read file data.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
export async function store<T>(args: object, bytes: Blob, content: string) {
  if (bytes.size > 25 * 1048576) throw new Error('Files must be 25 MB or smaller.');
  const stage = await rpc<string>('upload.begin');
  try {
    for (const [part, blob] of [
      ['file', bytes],
      ['content', new Blob([content])],
    ] as const) {
      for (let i = 0; i < blob.size; i += 144 * 1024)
        await rpc('upload.append', {
          id: stage,
          part,
          data: await base64(blob.slice(i, i + 144 * 1024)),
        });
    }
    return await rpc<T>('document.put', { ...args, stage });
  } catch (e) {
    await rpc('upload.cancel', { id: stage }).catch(() => {});
    throw e;
  }
}
