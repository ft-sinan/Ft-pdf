import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HardDrive,
  FolderPlus,
  RefreshCw,
  SlidersHorizontal,
  ImagePlus,
  ScanLine,
  LayoutGrid,
  ChevronRight,
  ChevronLeft,
  Search,
  X,
} from 'lucide-react';
import { rpc, privateRead, store } from '../device/bridge';
import { Doc, message, sizeOf } from '../types';
import { FileIcon } from './Art';
import { Spin, ErrorNote } from './UI';
type Entry = {
  id: string;
  source: string;
  name: string;
  folder: string;
  size: number;
  modified: number;
};
type Page = {
  allowed: boolean;
  enabled: boolean;
  folders: { id: string; name: string; readable: boolean }[];
  files: Entry[];
  total: number;
  checked: number;
  newCount: number;
  due: boolean;
  notice: string;
};
export default function PhoneHome({
  owner,
  open,
  photos,
  scanner,
  tools,
}: {
  owner: string;
  open: (d: Doc) => void;
  photos: () => void;
  scanner: () => void;
  tools: () => void;
}) {
  const [page, setPage] = useState<Page | null>(null),
    [q, query] = useState(''),
    [offset, offsetTo] = useState(0),
    [onlyNew, filterNew] = useState(false),
    [epoch, scanned] = useState(0),
    [scanning, setScanning] = useState(false),
    [sources, setSources] = useState(false),
    [loading, setLoading] = useState(''),
    [err, error] = useState('');
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const running = useRef(false),
    pending = useRef(false);
  const scan = useCallback(
    async (force: boolean) => {
      if (running.current) {
        pending.current ||= force;
        return;
      }
      running.current = true;
      try {
        do {
          pending.current = false;
          if (mounted.current) {
            setScanning(true);
            error('');
          }
          await rpc('phone.scan', { force, expectedOwner: owner });
          force = true;
        } while (pending.current && mounted.current);
      } catch (e) {
        if (mounted.current) error(message(e));
      } finally {
        running.current = false;
        if (mounted.current) {
          setScanning(false);
          scanned((n) => n + 1);
        }
      }
    },
    [owner],
  );
  useEffect(() => {
    // Display the durable catalogue first. A mount by itself never starts a fresh traversal.
    let live = true;
    const check = () => {
      if (document.hidden) return;
      void rpc<Page>('phone.page', { check: true, expectedOwner: owner })
        .then((snapshot) => {
          if (!live) return;
          scanned((n) => n + 1); // Recheck grants immediately even if a background diff is due.
          if (snapshot.due) void scan(false);
        })
        .catch((e) => {
          if (live) error(message(e));
        });
    };
    check();
    const updated = () => {
      filterNew(false);
      offsetTo(0);
      void scan(true);
    };
    window.addEventListener('ft:resume', check);
    window.addEventListener('ft:sources', updated);
    document.addEventListener('visibilitychange', check);
    return () => {
      live = false;
      window.removeEventListener('ft:resume', check);
      window.removeEventListener('ft:sources', updated);
      document.removeEventListener('visibilitychange', check);
    };
  }, [owner, scan]);
  useEffect(() => {
    let live = true;
    void rpc<Page>('phone.page', { q, offset, onlyNew, expectedOwner: owner })
      .then((p) => {
        if (!live) return;
        if (onlyNew && !p.newCount) {
          filterNew(false);
          offsetTo(0);
        } else if (offset > 0 && offset >= p.total) offsetTo(0);
        setPage(p);
      })
      .catch((e) => {
        if (live) error(message(e));
      });
    return () => {
      live = false;
    };
  }, [q, offset, onlyNew, epoch, owner]);
  async function act(op: string, id?: string) {
    error('');
    try {
      await rpc(op, { expectedOwner: owner, ...(id ? { id } : {}) });
      if (op === 'phone.stop' || op === 'phone.forget') {
        filterNew(false);
        offsetTo(0);
        scanned((n) => n + 1);
        const p = await rpc<Page>('phone.page', { check: true, expectedOwner: owner });
        if (p.due) void scan(false);
      }
    } catch (e) {
      error(message(e));
    }
  }
  async function select(f: Entry) {
    if (loading) return;
    setLoading(f.id);
    error('');
    try {
      if (f.size > 25 * 1048576) throw new Error('This file exceeds the 25 MB editor limit.');
      const blob = await (await privateRead('/phone-file/' + f.id)).blob(),
        hash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
          (b) => b.toString(16).padStart(2, '0'),
        ).join(''),
        source = f.source + ':' + hash;
      if (!mounted.current) return;
      let d = await rpc<Doc | null>('copy.find', { source, expectedOwner: owner });
      if (!d) {
        const { imported } = await import('../device/formats');
        const { bytes, content, ...meta } = await imported(new File([blob], f.name));
        if (!mounted.current) return;
        d = await store<Doc>(
          { ...meta, source, imported: true, expectedOwner: owner },
          bytes,
          content,
        );
      }
      if (mounted.current) open(d);
    } catch (e) {
      if (mounted.current) error(message(e));
    } finally {
      if (mounted.current) setLoading('');
    }
  }
  const connected =
    page && ((page.enabled && page.allowed) || page.folders.some((f) => f.readable));
  return (
    <div className="phone-home">
      <div className="quick-actions">
        <button aria-label="Scan document" onClick={scanner}>
          <ScanLine />
          <span>
            <strong>Scan document</strong>
            <small>Auto-capture paper pages</small>
          </span>
          <ChevronRight />
        </button>
        <button aria-label="Images to PDF" onClick={photos}>
          <ImagePlus />
          <span>
            <strong>Images to PDF</strong>
            <small>One photo per page</small>
          </span>
          <ChevronRight />
        </button>
        <button aria-label="Open PDF toolbox" onClick={tools}>
          <LayoutGrid />
          <span>
            <strong>PDF toolbox</strong>
            <small>Convert, organize & more</small>
          </span>
          <ChevronRight />
        </button>
      </div>
      <section className="phone-panel">
        <header>
          <div>
            <div className="eyebrow">
              <HardDrive size={13} />
              SHARED STORAGE
            </div>
            <h2>Documents on this phone</h2>
          </div>
          <div>
            <button
              className="icon-btn"
              disabled={!connected || scanning || !!loading}
              aria-label="Refresh phone documents"
              onClick={() => void scan(true)}
            >
              {scanning ? <Spin /> : <RefreshCw size={17} />}
            </button>
            <button
              className="icon-btn"
              aria-label="Manage phone sources"
              aria-expanded={sources}
              onClick={() => setSources(!sources)}
            >
              <SlidersHorizontal size={17} />
            </button>
          </div>
        </header>
        {page && (!connected || sources) && (
          <div className="phone-sources">
            <p>
              Show documents in shared storage, or choose just a folder. Opening a file saves an
              editable copy in this profile. Your original stays unchanged.
            </p>
            <div className="line-actions">
              {page.enabled && page.allowed ? (
                <button className="btn secondary" onClick={() => act('phone.stop')}>
                  Stop phone scan
                </button>
              ) : (
                <button className="btn primary" onClick={() => act('phone.access')}>
                  <HardDrive size={15} />
                  Scan my phone
                </button>
              )}
              <button className="btn secondary" onClick={() => act('phone.folder')}>
                <FolderPlus size={15} />
                Choose folder
              </button>
            </div>
            {page.folders.map((f) => (
              <button
                key={f.id}
                className="source-chip"
                onClick={() => act('phone.forget', f.id)}
                aria-label={'Disconnect ' + f.name}
              >
                {f.name}
                {!f.readable && ' · access lost'}
                <X size={13} />
              </button>
            ))}
          </div>
        )}
        {connected && (
          <>
            <div className="phone-checkpoint">
              <span>
                {scanning
                  ? page.checked
                    ? 'Checking for changes…'
                    : 'Finding documents…'
                  : page.checked
                    ? 'Last checked ' +
                      new Date(page.checked).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Ready to check'}
              </span>
              {page.newCount > 0 && (
                <button
                  className="text-btn"
                  aria-pressed={onlyNew}
                  onClick={() => {
                    filterNew(!onlyNew);
                    offsetTo(0);
                    query('');
                  }}
                >
                  {onlyNew
                    ? 'Show all files'
                    : `${page.newCount} new ${page.newCount === 1 ? 'document' : 'documents'} · View`}
                </button>
              )}
            </div>
            <label className="phone-search">
              <Search size={15} />
              <input
                aria-label="Search phone files"
                placeholder="Search phone files or folders…"
                value={q}
                onChange={(e) => {
                  query(e.target.value);
                  offsetTo(0);
                }}
              />
            </label>
            {page.files.map((f) => (
              <button
                className="phone-file"
                key={f.id}
                onClick={() => select(f)}
                disabled={!!loading}
                aria-label={'Open phone file ' + f.name}
              >
                <FileIcon
                  type={
                    /\.pdf$/i.test(f.name)
                      ? 'pdf'
                      : /\.docx?$/i.test(f.name)
                        ? 'docx'
                        : /\.html?$/i.test(f.name)
                          ? 'html'
                          : 'txt'
                  }
                />
                <span>
                  <strong>{f.name}</strong>
                  <small>
                    {f.folder}
                    {f.size >= 0 ? ' · ' + sizeOf(f.size) : ''}
                  </small>
                </span>
                {loading === f.id ? <Spin /> : <ChevronRight size={16} />}
              </button>
            ))}
            {!page.files.length && !scanning && (
              <p className="muted">
                {q
                  ? 'No files match this search.'
                  : 'No PDF, Word, TXT or HTML files found in these sources.'}
              </p>
            )}
            {page.total > 0 && (
              <footer>
                <small>
                  {offset + 1}–{Math.min(offset + page.files.length, page.total)} of {page.total}
                </small>
                <button
                  className="icon-btn"
                  disabled={offset === 0}
                  aria-label="Previous phone files"
                  onClick={() => offsetTo((n) => Math.max(0, n - 12))}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="icon-btn"
                  disabled={offset + 12 >= page.total}
                  aria-label="Next phone files"
                  onClick={() => offsetTo((n) => n + 12)}
                >
                  <ChevronRight size={16} />
                </button>
              </footer>
            )}
          </>
        )}
        {page?.notice && <p className="muted">{page.notice}</p>}
        <ErrorNote text={err} />
      </section>
    </div>
  );
}
