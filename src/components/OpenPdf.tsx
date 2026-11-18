import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Doc, type Workspace, message, fileName, onDevice } from '../types';
import { selectedPdf, type PdfSource } from '../externalPdf';
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
export default function OpenPdf() {
  const [doc, setDoc] = useState<Doc | null>(null),
    [copy, setCopy] = useState<Doc | null>(null),
    [failed, fail] = useState(''),
    [retry, again] = useState(0),
    [notice, notify] = useState(''),
    [trash, askTrash] = useState(false);
  const [source, setSource] = useState<PdfSource | null>(null);
  const back = useRef<(() => void) | null>(null),
    owner = useRef('');
  useEffect(() => {
    let live = true;
    fail('');
    selectedPdf()
      .then((item) => {
        if (live) {
          setSource(item);
          setDoc({
            id: item.id,
            name: (item.name || 'Document').replace(/\.pdf$/i, '') || 'Document',
            type: 'pdf',
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
        title="Could not open PDF"
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
        Opening PDF…
      </div>
    );
  return (
    <>
      <Editor
        d={copy || doc}
        close={close}
        closeLabel="Close PDF"
        backAction={back}
        onDirty={noop}
        notify={notify}
        external={
          copy
            ? undefined
            : {
                read: source.read,
                protection,
                beginEdit: async () => {
                  const w = await api<Workspace>('/workspace');
                  owner.current = w.user.id;
                },
                saveCopy: async (blob) => {
                  const form = new FormData();
                  form.append('file', blob, doc.name.slice(0, 130) + '.pdf');
                  form.append('name', doc.name.slice(0, 130) + '.pdf');
                  return api<Doc>('/documents/import', 'POST', form, {
                    'X-Ft-Owner': owner.current,
                  });
                },
              }
        }
        remove={copy ? () => askTrash(true) : undefined}
        onSaved={(d) => {
          setCopy(d);
          changed();
          notify(copy ? 'Changes saved' : 'Edited copy saved to your library');
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
