import { rpc, privateRead, store } from './bridge';
import type { Doc, Kind } from '../types';
export async function deviceApi<T>(
  path: string,
  method: string,
  input: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const a = (input || {}) as Record<string, string>;
  if (path === '/workspace') return rpc<T>('workspace');
  if (path.startsWith('/auth/')) return rpc<T>(path.slice(6), a);
  if (path === '/settings') return rpc<T>('settings', a);
  const [, group, id, action] = path.split('/');
  if (group === 'collections')
    return rpc<T>(method === 'DELETE' ? 'collection.delete' : 'collection.put', {
      ...a,
      ...(id ? { id } : {}),
    });
  if (group !== 'documents') throw new Error('Unknown device action.');
  if (!id && method === 'POST') {
    if (a.type === 'pdf') return rpc<T>('pdf.create', a);
    const { encode } = await import('./formats');
    const result = await encode(
      a.type as Kind,
      a.name,
      a.type === 'docx'
        ? '<p></p>'
        : a.type === 'html'
          ? '<!doctype html>\n<html lang="en">\n<head><title>New page</title></head>\n<body>\n  <h1>Hello, world!</h1>\n</body>\n</html>'
          : '',
    );
    return store<T>(a, result.bytes, result.content);
  }
  if (id === 'import' && input instanceof FormData) {
    const f = input.get('file');
    if (!(f instanceof File)) throw new Error('Choose a file to open.');
    const { imported } = await import('./formats'),
      { bytes, content, ...meta } = await imported(f);
    return store<T>(
      { ...meta, imported: true, collectionId: input.get('collectionId') || null },
      bytes,
      content,
    );
  }
  if (action === 'open') return rpc<T>('document.open', { id });
  if (action === 'content' && method === 'GET') {
    const r = await privateRead(`/device-file/${id}/content`);
    return { content: await r.text(), updated: Number(r.headers.get('X-Ft-Updated')) } as T;
  }
  if (action === 'content' && method === 'PUT') {
    const d = await rpc<Doc>('document.info', { id }),
      { pdfInfo, encode } = await import('./formats');
    const result =
      input instanceof Blob
        ? { bytes: input, content: '', ...(await pdfInfo(input)) }
        : await encode(d.type, d.name, a.content);
    const { bytes, content, ...meta } = result;
    return store<T>(
      { id, type: d.type, ...meta, expected: Number(headers['If-Unmodified-Since-Ms']) },
      bytes,
      content,
    );
  }
  if (method === 'PATCH') return rpc<T>('document.patch', { ...a, id });
  if (method === 'DELETE') return rpc<T>('document.delete', { id });
  throw new Error('Unknown document action.');
}
