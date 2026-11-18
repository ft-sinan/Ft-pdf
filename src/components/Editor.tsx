import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Pencil,
  Trash2,
  BookOpen,
  Bold,
  Check,
  Code2,
  Download,
  Eye,
  FileText,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Save,
  Underline,
  Undo2,
} from 'lucide-react';
import {
  api,
  onDevice,
  Collection,
  Doc,
  downloadDoc,
  fileName,
  labels,
  message,
  sizeOf,
} from '../types';
import { FileIcon } from './Art';
import { Confirm } from './Forms';
import { HtmlPreview } from './HtmlPreview';
import { Empty, ErrorNote, Spin } from './UI';
import type { PdfHandle } from './PdfSurface';
import './editor.css';
const PdfSurface = lazy(() => import('./PdfSurface'));
function RichPage({
  initial,
  changed,
  disabled,
  inner,
}: {
  initial: string;
  changed: (s: string) => void;
  disabled: boolean;
  inner: React.RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    if (inner.current) inner.current.innerHTML = initial;
  }, [initial, inner]);
  return (
    <div
      className="rich-page paper-sheet"
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Word document content"
      data-placeholder="Start writing your document…"
      ref={inner}
      onInput={(e) => changed(e.currentTarget.innerHTML)}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      onDrop={(e) => e.preventDefault()}
    />
  );
}
export default function Editor({
  d,
  collection,
  close,
  remove,
  backAction,
  onDirty,
  onSaved,
  notify,
}: {
  d: Doc;
  collection?: Collection;
  close: () => void;
  remove: () => void;
  backAction: React.RefObject<(() => void) | null>;
  onDirty: (b: boolean) => void;
  onSaved: (d: Doc) => void;
  notify: (s: string, err?: boolean) => void;
}) {
  const [editing, setEditing] = useState(false),
    [discard, askDiscard] = useState(false),
    [initial, setInitial] = useState(''),
    [content, setContent] = useState(''),
    [loading, setLoading] = useState(d.type !== 'pdf'),
    [failure, setFailure] = useState(''),
    [saveErr, setSaveErr] = useState(''),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [tab, setTab] = useState<'source' | 'preview'>('source'),
    [rev, setRev] = useState(0),
    [retry, setRetry] = useState(0);
  const pdf = useRef<PdfHandle>(null),
    rich = useRef<HTMLDivElement>(null),
    version = useRef(d.updated),
    original = useRef(''),
    saving = useRef(false),
    action = useRef<(download?: boolean) => void>(() => {});
  useEffect(() => {
    if (d.type === 'pdf') return;
    let live = true;
    setLoading(true);
    setFailure('');
    api<{ content: string; updated: number }>(`/documents/${d.id}/content`)
      .then((r) => {
        if (live) {
          original.current = r.content;
          version.current = r.updated;
          setInitial(r.content);
          setContent(r.content);
          setReady(true);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setFailure(message(e));
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [d.id, d.type, retry]);
  const pdfDirty = useCallback((v: boolean) => setDirty(v), []);
  useEffect(() => {
    onDirty(dirty);
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const change = (s: string) => {
    setContent(s);
    setDirty(s !== original.current);
    setSaveErr('');
  };
  const save = async (download = false) => {
    if (saving.current || !ready) return;
    if (!dirty) {
      if (download) await downloadDoc(d).catch((e) => setSaveErr(message(e)));
      return;
    }
    saving.current = true;
    setBusy(true);
    setSaveErr('');
    try {
      const body = d.type === 'pdf' ? await pdf.current!.exportFile() : { content };
      const saved = await api<Doc>(`/documents/${d.id}/content`, 'PUT', body, {
        'If-Unmodified-Since-Ms': String(version.current),
      });
      version.current = saved.updated;
      original.current = content;
      setDirty(false);
      onDirty(false);
      onSaved(saved);
      if (d.type === 'pdf') setRev((n) => n + 1);
      if (download) await downloadDoc(saved);
    } catch (e) {
      setSaveErr(message(e));
    } finally {
      setBusy(false);
      saving.current = false;
    }
  };
  action.current = save;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void action.current();
      }
    };
    if (!editing) return;
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [editing]);
  const read = useCallback(() => {
    setContent(original.current);
    setInitial(original.current);
    setDirty(false);
    onDirty(false);
    setSaveErr('');
    setTab('source');
    setEditing(false);
    askDiscard(false);
  }, [onDirty]);
  const requestRead = useCallback(() => {
    if (busy) return;
    if (dirty) askDiscard(true);
    else read();
  }, [busy, dirty, read]);
  useEffect(() => {
    backAction.current = editing ? requestRead : null;
    return () => {
      backAction.current = null;
    };
  }, [editing, requestRead, backAction]);
  const command = (cmd: string, value?: string) => {
    rich.current?.focus();
    document.execCommand(cmd, false, value);
    if (rich.current) change(rich.current.innerHTML);
  };
  const wordCount =
    !editing || d.type === 'pdf' || d.type === 'html'
      ? 0
      : (d.type === 'docx' ? content.replace(/<[^>]*>/g, ' ') : content)
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;
  return (
    <div
      className={`editor-shell ${editing ? 'editing' : 'reading'}`}
      data-mode={editing ? 'edit' : 'read'}
    >
      <header className="editor-header">
        <button
          className="icon-btn back-btn"
          aria-label={editing ? 'Back to reader' : 'Back to workspace'}
          title={editing ? 'Back to reader' : 'Back to workspace'}
          disabled={busy}
          onClick={editing ? requestRead : close}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="editor-title">
          <FileIcon type={d.type} />
          <span>
            <strong title={fileName(d)}>{fileName(d)}</strong>
            <small>
              {editing ? 'Editing' : d.locked ? 'Protected · Read only' : 'Reading'} <i>/</i>{' '}
              {collection?.name || labels[d.type]}
            </small>
          </span>
        </div>
        <div className="save-tools">
          {editing && (
            <span className={`save-status ${dirty ? 'dirty' : ''}`}>
              {dirty ? <i /> : <Check size={13} />}
              {dirty ? 'Unsaved changes' : 'Saved'}
            </span>
          )}
          {!editing && (
            <button
              className="btn secondary reader-delete"
              aria-label="Delete document"
              title="Move to Trash"
              onClick={remove}
            >
              <Trash2 size={16} />
              <span>Delete</span>
            </button>
          )}
          <button
            className="btn secondary download-btn"
            disabled={busy || (editing && !ready)}
            aria-label={onDevice ? 'Save a copy to Files' : 'Download document'}
            title={
              onDevice
                ? 'Save a copy to Android Files'
                : dirty
                  ? 'Save and download'
                  : 'Download document'
            }
            onClick={() =>
              editing ? void save(true) : void downloadDoc(d).catch((e) => setSaveErr(message(e)))
            }
          >
            <Download size={16} />
          </button>
          {editing ? (
            <button
              className="btn primary save-btn"
              disabled={!dirty || busy || !ready}
              onClick={() => void save()}
            >
              {busy ? <Spin size={15} /> : <Save size={15} />}
              <span>{busy ? 'Saving…' : 'Save changes'}</span>
            </button>
          ) : (
            !d.locked && (
              <button
                className="btn primary read-edit-btn"
                disabled={!ready}
                onClick={() => {
                  setInitial(content);
                  setEditing(true);
                }}
              >
                <Pencil size={15} />
                Edit
              </button>
            )
          )}
        </div>
      </header>
      {saveErr && (
        <div className="editor-alert">
          <ErrorNote text={saveErr} />
        </div>
      )}
      {d.type === 'pdf' ? (
        <Suspense
          fallback={
            <div className="editor-loading">
              <Spin />
              Opening PDF…
            </div>
          }
        >
          <PdfSurface
            ref={pdf}
            d={d}
            revision={rev}
            editing={editing}
            busy={busy}
            onReady={setReady}
            onDirty={pdfDirty}
            commit={async (blob) => {
              if (saving.current) throw new Error('A save is already in progress.');
              saving.current = true;
              setBusy(true);
              try {
                const saved = await api<Doc>(`/documents/${d.id}/content`, 'PUT', blob, {
                  'If-Unmodified-Since-Ms': String(version.current),
                });
                version.current = saved.updated;
                setDirty(false);
                onDirty(false);
                onSaved(saved);
                setRev((n) => n + 1);
              } finally {
                setBusy(false);
                saving.current = false;
              }
            }}
          />
        </Suspense>
      ) : (
        <>
          {editing && (
            <div className="editor-tools">
              {d.type === 'docx' ? (
                <>
                  <select
                    className="paragraph-select"
                    aria-label="Paragraph style"
                    defaultValue="p"
                    onChange={(e) => command('formatBlock', e.target.value)}
                  >
                    <option value="p">Paragraph</option>
                    <option value="h1">Heading 1</option>
                    <option value="h2">Heading 2</option>
                    <option value="h3">Heading 3</option>
                  </select>
                  <i className="tool-sep" />
                  {(
                    [
                      ['bold', 'Bold', Bold],
                      ['italic', 'Italic', Italic],
                      ['underline', 'Underline', Underline],
                      ['insertUnorderedList', 'Bullet list', List],
                      ['insertOrderedList', 'Numbered list', ListOrdered],
                      ['undo', 'Undo', Undo2],
                      ['redo', 'Redo', Redo2],
                    ] as const
                  ).map(([cmd, label, I]) => (
                    <button
                      key={cmd}
                      className="icon-btn"
                      title={label}
                      aria-label={label}
                      disabled={!ready || busy}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => command(cmd)}
                    >
                      <I size={16} />
                    </button>
                  ))}
                </>
              ) : d.type === 'html' ? (
                <div className="tool-group">
                  <button
                    className={`tool-button ${tab === 'source' ? 'active' : ''}`}
                    onClick={() => setTab('source')}
                  >
                    <Code2 size={16} />
                    Source
                  </button>
                  <button
                    className={`tool-button ${tab === 'preview' ? 'active' : ''}`}
                    onClick={() => setTab('preview')}
                  >
                    <Eye size={16} />
                    Preview
                  </button>
                </div>
              ) : (
                <div className="plain-label">
                  <FileText size={15} />
                  Plain text editor
                </div>
              )}
              <span className="editor-format">.{d.type}</span>
            </div>
          )}
          {failure ? (
            <div className="editor-issue">
              <Empty
                title="Could not open document"
                body={failure}
                action={
                  <button className="btn secondary" onClick={() => setRetry((n) => n + 1)}>
                    Try again
                  </button>
                }
              />
            </div>
          ) : loading ? (
            <div className="editor-loading">
              <Spin />
              Opening document…
            </div>
          ) : (
            <div
              tabIndex={editing ? undefined : 0}
              role={editing ? undefined : 'region'}
              aria-label={editing ? undefined : 'Scrollable document'}
              className={`writing-area ${d.type === 'html' ? 'html-area' : ''}`}
            >
              {!editing ? (
                d.type === 'html' ? (
                  <HtmlPreview content={content} />
                ) : (
                  <>
                    <div className="editor-paper-caption">{labels[d.type].toUpperCase()}</div>
                    {d.type === 'docx' ? (
                      <article
                        aria-label="Word document content"
                        className="rich-page paper-sheet"
                        onClick={(e) => {
                          if ((e.target as Element).closest('a')) e.preventDefault();
                        }}
                        dangerouslySetInnerHTML={{ __html: content }}
                      />
                    ) : (
                      <article aria-label="Plain text content" className="paper-sheet reader-text">
                        {content}
                      </article>
                    )}
                  </>
                )
              ) : d.type === 'docx' ? (
                <>
                  <div className="editor-paper-caption">EDITABLE WORD DOCUMENT</div>
                  <RichPage initial={initial} inner={rich} disabled={busy} changed={change} />
                </>
              ) : d.type === 'html' && tab === 'preview' ? (
                <HtmlPreview content={content} />
              ) : (
                <>
                  <div className="editor-paper-caption">
                    {d.type === 'txt' ? 'PLAIN TEXT DOCUMENT' : 'HTML SOURCE'}
                  </div>
                  <textarea
                    className={`text-page paper-sheet ${d.type === 'html' ? 'source-code' : ''}`}
                    aria-label={d.type === 'txt' ? 'Plain text content' : 'HTML source code'}
                    placeholder="Start writing here…"
                    value={content}
                    onChange={(e) => change(e.target.value)}
                    disabled={busy}
                    spellCheck={d.type === 'txt'}
                  />
                </>
              )}
            </div>
          )}
          {editing ? (
            <div className="editor-foot">
              <span>
                {d.type === 'docx'
                  ? 'WORD DOCUMENT'
                  : d.type === 'html'
                    ? 'HTML EDITOR'
                    : 'TEXT DOCUMENT'}
              </span>
              {d.type === 'docx' ? (
                <button
                  onClick={() =>
                    notify(
                      'Word exports preserve text, basic formatting, tables, and common embedded images. Download the original first if exact layout, headers, or tracked changes are important.',
                    )
                  }
                >
                  Formatting details
                </button>
              ) : null}
              <span>
                {d.type === 'html'
                  ? `${content.length.toLocaleString()} characters`
                  : `${wordCount.toLocaleString()} words`}{' '}
                <i>·</i> {sizeOf(d.size)}
              </span>
            </div>
          ) : (
            <div className="reader-foot">
              <span>
                <BookOpen size={13} />
                Reading view
              </span>
              <span>{sizeOf(d.size)}</span>
            </div>
          )}
        </>
      )}
      {discard && (
        <Confirm
          title="Discard unsaved changes?"
          body="Your saved document will stay as it was. Cancel to keep editing or save your changes."
          label="Discard and read"
          onClose={() => askDiscard(false)}
          onConfirm={read}
        />
      )}
    </div>
  );
}
