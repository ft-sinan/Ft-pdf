import { onDevice } from './types';

export type PdfSource = {
  id: string;
  name: string;
  size: number;
  read: (signal: AbortSignal) => Promise<Response>;
};
export type FileLaunchQueue = {
  setConsumer(fn: (p: { files?: FileSystemFileHandle[] }) => void): void;
};
export const launchQueue = () => (window as Window & { launchQueue?: FileLaunchQueue }).launchQueue;

// A PDF file handler gets its own client. Never upload a file just to view it.
let webLaunch: Promise<FileSystemFileHandle> | undefined;
function webHandle() {
  const queue = launchQueue();
  if (!queue) throw Error('Open a PDF from Files using the installed app.');
  return (webLaunch ??= new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error('No PDF was received. Open it again from Files.')),
      12000,
    );
    queue.setConsumer(({ files }) => {
      clearTimeout(timer);
      if (files?.length === 1) resolve(files[0]);
      else reject(Error('Open one PDF from Files, or import multiple files in the library.'));
    });
  }));
}
export async function selectedPdf(): Promise<PdfSource> {
  let source: PdfSource;
  if (onDevice) {
    const { privateRead, rpc } = await import('./device/bridge');
    const [item] = await rpc<Omit<PdfSource, 'read'>[]>('inbox.list');
    if (!item) throw Error('Access to the selected file expired. Open it again from Files.');
    source = {
      ...item,
      read: (signal) =>
        privateRead('/inbox/' + item.id, signal).catch(() => {
          throw Error('Could not read the selected PDF. Open it again from Files.');
        }),
    };
  } else {
    const file = await (await webHandle()).getFile();
    source = {
      id: 'external',
      name: file.name,
      size: file.size,
      read: async () => new Response(file),
    };
  }
  if (source.size > 25 * 1048576) throw Error('This PDF is larger than the 25 MB file limit.');
  return source;
}
