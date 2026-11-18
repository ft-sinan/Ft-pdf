import { privateRead, rpc } from './bridge';
type Incoming = { id: string; name: string; size: number };
// Hold content URI grants in native code; give only bounded file bytes to the import form.
export async function receiveFiles() {
  const docs = await rpc<Incoming[]>('inbox.list');
  let size = 0;
  const files: File[] = [],
    errors: string[] = [];
  for (const d of docs) {
    try {
      if (d.size > 25 * 1048576 || size + Math.max(d.size, 0) > 100 * 1048576)
        throw new Error('Import fewer or smaller files (25 MB each).');
      const blob = await (await privateRead('/inbox/' + d.id)).blob();
      size += blob.size;
      if (size > 100 * 1048576) throw new Error('Import fewer files at once.');
      files.push(new File([blob], d.name));
    } catch (e) {
      errors.push(`${d.name}: ${e instanceof Error ? e.message : 'File unavailable'}`);
    }
  }
  return {
    files,
    errors,
    ack: () => Promise.all(docs.map((d) => rpc('inbox.done', { id: d.id }))),
  };
}
