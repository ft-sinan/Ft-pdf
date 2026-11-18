import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Doc, type Workspace, message, fileName, onDevice, type Kind } from '../types';
import { selectedFile, type FileSource } from '../externalFile';
import Editor from './Editor';
import { Confirm } from './Forms';
import { Empty, Spin } from './UI';

const noop = () => {},
  close = () => {
    if (onDevice) void import('../device/bridge').then(({ rpc }) => rpc('reader.close'));
    else location.replace('/');
  };
/** ACTION_VIEW is not an import. Read the OS-granted stream directly; neither opening,
 * scrolling nor cancelling an edit needs an account, file picker or library storage. */
export default function OpenFile() {
  const [doc, setDoc] = useState<Doc | null>(null),
    [copy, setCopy] = useState<Doc | null>(null),
    [failed, fail] = useState(''),
    [retry, again] = useState(0),
    [notice, notify] = useState(''),
    [trash, askTrash] = useState(false);
  const [source, setSource] = useState<FileSource | null>(null);
  const [text, setText] = useState<string>();
  const back = useRef<(() => void) | null>(null),
    owner = useRef('');
  useEffect(() => {
    let live = true;
    fail('');
    const abort = new AbortController();
    selectedFile()
      .then(async (item) => {
        const ext = item.name.split('.').pop()?.toLowerCase() || '';
        if (!['pdf', 'doc', 'docx', 'txt', 'htm', 'html'].includes(ext))
          throw Error('This document format is not supported.');
        let type: Kind = ext === 'doc' ? 'docx' : ext === 'htm' ? 'html' : (ext as Kind);
        if (type !== 'pdf') {
          const input = await (await item.read(abort.signal)).blob();
          if (!live) return;
          const { imported } = await import('../device/formats');
          const parsed = await imported(new File([input], item.name), true);
          if (!live) return;
          setText(parsed.content);
          type = parsed.type;
          item = { ...item, read: async () => new Response(input), size: input.size };
        }
        if (live) {
          setSource(item);
          setDoc({
            id: item.id,
            name: (item.name || 'Document').replace(/\.[^.]+$/, '') || 'Document',
            type,
            size: item.size,
            locked: false,
            pages: null,
            collectionId: null,
            created: 0,
            updated: 0,
            opened: 0,
            trashed: false,
            starred: false,
            cover: 'report',
          });
        }
      })
      .catch((e) => {
        if (live) fail(message(e));
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [retry]);
  useEffect(() => {
    const handle = (e: Event) => {
      if (document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } else if (back.current) {
        e.preventDefault();
        back.current();
      }
    };
    window.addEventListener('ft:back', handle);
    return () => window.removeEventListener('ft:back', handle);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const time = setTimeout(() => notify(''), 4000);
    return () => clearTimeout(time);
  }, [notice]);
  const protection = useCallback(
    (locked: boolean) => setDoc((d) => (d && d.locked !== locked ? { ...d, locked } : d)),
    [],
  );
  const changed = () => {
    try {
      localStorage.setItem('ft:library-change', String(Date.now()));
    } catch {
      /* File was saved; refreshing the library can wait for its next launch. */
    }
  };
  if (failed)
    return (
      <Empty
        title="Could not open document"
        body={failed}
        action={
          <>
            <button className="btn secondary" onClick={close}>
              Close
            </button>{' '}
            <button className="btn primary" onClick={() => again((n) => n + 1)}>
              Try again
            </button>
          </>
        }
      />
    );
  if (!doc || !source)
    return (
      <div className="editor-loading" role="status">
        <Spin />
        Opening document…
      </div>
    );
  const addCopy = async (bytes: Blob, name: string) => {
    const form = new FormData();
    form.append('file', bytes, name);
    form.append('name', name);
    return api<Doc>('/documents/import', 'POST', form, { 'X-Ft-Owner': owner.current });
  };
  const beginEdit = async () => {
    owner.current = (await api<Workspace>('/workspace')).user.id;
  };
  return (
    <>
      <Editor
        d={copy || doc}
        close={close}
        closeLabel={doc.type === 'pdf' ? 'Close PDF' : 'Close document'}
        backAction={back}
        onDirty={noop}
        notify={notify}
        external={
          copy
            ? undefined
            : {
                read: source.read,
                protection,
                name: source.name,
                text,
                beginEdit,
                keep: async () => {
                  await beginEdit();
                  const bytes = await (await source.read(new AbortController().signal)).blob();
                  return addCopy(
                    bytes,
                    doc.name.slice(0, 130) + '.' + source.name.split('.').pop()!.toLowerCase(),
                  );
                },
                saveCopy: async (body) => {
                  const bytes =
                    body instanceof Blob
                      ? body
                      : (
                          await (
                            await import('../device/formats')
                          ).encode(doc.type, doc.name, body.content)
                        ).bytes;
                  return addCopy(bytes, doc.name.slice(0, 130) + '.' + doc.type);
                },
              }
        }
        remove={copy ? () => askTrash(true) : undefined}
        onSaved={(d) => {
          setCopy(d);
          changed();
          notify(copy ? 'Changes saved' : 'Copy saved to your library');
        }}
      />
      {trash && copy && (
        <Confirm
          title="Move library copy to Trash?"
          body={`“${fileName(copy)}” can be restored from Trash. Your original in Files is not deleted.`}
          label="Move to Trash"
          onClose={() => askTrash(false)}
          onConfirm={async () => {
            await api(`/documents/${copy.id}`, 'PATCH', { trashed: true });
            changed();
            close();
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </>
  );
}
