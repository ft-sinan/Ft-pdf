import AndroidDialog from './components/AndroidDialog';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  Clock3,
  Download,
  Ellipsis,
  ExternalLink,
  FileStack,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  HardDrive,
  History,
  LayoutDashboard,
  Wrench,
  LogIn,
  LogOut,
  Menu,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Smartphone,
  Star,
  Trash2,
  Upload,
  UserRoundPlus,
  X,
} from 'lucide-react';
import {
  api,
  onDevice,
  ago,
  Collection,
  Doc,
  downloadDoc,
  fileName,
  initials,
  labels,
  message,
  sizeOf,
  User,
  View,
  Workspace,
} from './types';
import { Brand, DocCard, PaperArt } from './components/Art';
import { Anchor, Empty, Modal, Popup, Spin } from './components/UI';
import {
  AuthForm,
  CollectionForm,
  Confirm,
  ImportForm,
  MetaForm,
  NewForm,
  SearchDialog,
  Settings,
} from './components/Forms';
import Welcome, { PracticeFile } from './components/Welcome';
import { saveProfile } from './profile';
import { launchQueue } from './externalPdf';
import { DocTable, Library, SectionTitle } from './components/Library';
const Editor = lazy(() => import('./components/Editor'));
const PhoneHome = lazy(() => import('./components/PhoneHome'));
const PhotoForm = lazy(() => import('./components/PhotoForm'));
const Toolbox = lazy(() => import('./components/Toolbox'));
type Dialog = {
  kind:
    | 'new'
    | 'photos'
    | 'toolbox'
    | 'android'
    | 'import'
    | 'search'
    | 'collection'
    | 'settings'
    | 'login'
    | 'register'
    | 'logout'
    | 'rename'
    | 'move'
    | 'tour'
    | 'readerTrash'
    | 'delete'
    | 'removeCollection';
  d?: Doc;
  c?: Collection;
};
type Pop = { kind: 'doc' | 'account' | 'activity' | 'collection'; d?: Doc; anchor: Anchor };
type Toast = { n: number; msg: string; error?: boolean; undo?: () => void };
const views: Record<string, string> = {
  overview: 'Overview',
  documents: 'All documents',
  starred: 'Starred',
  trash: 'Trash',
};
function readRoute() {
  const [base, id] = location.hash.replace(/^#\/?/, '').split(/\/(?:read|edit)\//);
  return {
    view: (base in views || base.startsWith('collection/') ? base : 'overview') as View,
    id: id || null,
  };
}
function Boot({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="boot">
      <div className="boot-brand">
        <Brand />
      </div>
      {error ? (
        <Empty
          title="Workspace unavailable"
          body={error}
          icon={<CircleAlert />}
          action={
            <button className="btn primary" onClick={retry}>
              Try again
            </button>
          }
        />
      ) : (
        <div className="boot-work" role="status">
          <span className="sr-only">Loading your workspace…</span>
          <div className="skeleton one" />
          <div className="skeleton two" />
          <div className="skeleton three" />
          <div className="skeleton four" />
        </div>
      )}
    </div>
  );
}
export default function App() {
  const [w, setW] = useState<Workspace | null>(null),
    [error, setError] = useState(''),
    [route, setRoute] = useState(readRoute),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [pop, setPop] = useState<Pop | null>(null),
    [drawer, setDrawer] = useState(false),
    [toast, setToast] = useState<Toast | null>(null),
    [incoming, setIncoming] = useState<File[]>([]),
    [seen, setSeen] = useState(false);
  const settingUp = !!w?.user.needsSetup;
  const editorBack = useRef<(() => void) | null>(null),
    dirty = useRef(false),
    currentHash = useRef(location.hash),
    locks = useRef(new Set<string>()),
    serial = useRef(0);
  const notify = useCallback(
    (msg: string, error = false, undo?: () => void) =>
      setToast({ n: ++serial.current, msg, error, undo }),
    [],
  );
  const load = useCallback(async () => {
    setError('');
    try {
      setW(await api<Workspace>('/workspace'));
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (w) document.documentElement.dataset.theme = w.user.theme;
  }, [w?.user.theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 4200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const fn = () => {
      if (dirty.current && !window.confirm('Leave without saving your changes?')) {
        history.replaceState(null, '', currentHash.current || location.pathname);
        return;
      }
      dirty.current = false;
      currentHash.current = location.hash;
      setRoute(readRoute());
      setPop(null);
      setDrawer(false);
      setDialog(null);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (settingUp) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !route.id) {
        e.preventDefault();
        setPop(null);
        setDrawer(false);
        setDialog((d) => (d?.kind === 'search' ? null : { kind: 'search' }));
      }
      if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [route.id, settingUp]);
  useEffect(() => {
    const back = (e: Event) => {
      if (settingUp) return;
      if (document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } else if (pop || drawer) {
        e.preventDefault();
        setPop(null);
        setDrawer(false);
      } else if (route.id) {
        e.preventDefault();
        if (editorBack.current) editorBack.current();
        else location.hash = `/${route.view}`;
      }
    };
    window.addEventListener('ft:back', back);
    return () => window.removeEventListener('ft:back', back);
  }, [drawer, pop, route, settingUp]);
  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawer]);
  useEffect(() => {
    if (!onDevice || !w || settingUp || dialog) return;
    let live = true,
      busy = false,
      again = false;
    const drain = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const { receiveFiles } = await import('./device/inbox');
        const result = await receiveFiles();
        if (!live) return;
        await result.ack();
        if (!live) return;
        if (result.errors.length) notify(result.errors.join(' '), true);
        if (result.files.length) {
          setIncoming(result.files);
          setDialog({ kind: 'import' });
        }
      } catch (e) {
        if (live) notify(message(e), true);
      } finally {
        busy = false;
        if (live && again) {
          again = false;
          void drain();
        }
      }
    };
    void drain();
    window.addEventListener('ft:inbox', drain);
    return () => {
      live = false;
      window.removeEventListener('ft:inbox', drain);
    };
  }, [w?.user.id, settingUp, dialog, notify]);
  // Installed applications can open files directly with the OS file picker.
  useEffect(() => {
    if (onDevice || !w || settingUp) return;
    let live = true;
    launchQueue()?.setConsumer(async ({ files }) => {
      if (!files?.length) return;
      try {
        const f = await Promise.all(files.map((h) => h.getFile()));
        if (live) {
          setIncoming(f);
          setDialog({ kind: 'import' });
        }
      } catch (e) {
        if (live) notify(message(e), true);
      }
    });
    return () => {
      live = false;
    };
  }, [w?.user.id, settingUp]);
  useEffect(() => {
    if (onDevice || !w || settingUp || !('caches' in window)) return;
    const url = new URL(location.href);
    if (!url.searchParams.has('shared')) return;
    let live = true;
    (async () => {
      try {
        const cache = await caches.open('ft-share-inbox'),
          keys = await cache.keys(),
          files: File[] = [];
        for (const key of keys) {
          const r = await cache.match(key);
          if (r) {
            const blob = await r.blob();
            files.push(
              new File([blob], decodeURIComponent(r.headers.get('x-ft-name') || 'document.txt'), {
                type: blob.type,
              }),
            );
            await cache.delete(key);
          }
        }
        if (live && files.length) {
          setIncoming(files);
          setDialog({ kind: 'import' });
        }
        url.searchParams.delete('shared');
        history.replaceState(null, '', url);
      } catch (e) {
        notify(message(e), true);
      }
    })();
    return () => {
      live = false;
    };
  }, [w?.user.id, settingUp, notify]);
  const nav = (v: View, id?: string) => {
    setPop(null);
    setDrawer(false);
    setDialog(null);
    location.hash = `/${v}${id ? `/read/${id}` : ''}`;
  };
  const modal = (d: Dialog) => {
    setPop(null);
    setDrawer(false);
    if (d.kind === 'import') setIncoming([]);
    setDialog(d);
  };
  const upsert = useCallback(
    (d: Doc) =>
      setW(
        (s) =>
          s && {
            ...s,
            documents: s.documents.some((x) => x.id === d.id)
              ? s.documents.map((x) => (x.id === d.id ? d : x))
              : [d, ...s.documents],
          },
      ),
    [],
  );
  const onDirty = useCallback((v: boolean) => {
    dirty.current = v;
  }, []);
  const open = (d: Doc) => {
    if (!d.trashed) nav(route.view, d.id);
  };
  useEffect(() => {
    if (!w || settingUp || !route.id) return;
    let live = true;
    api<Doc>(`/documents/${route.id}/open`, 'POST')
      .then((opened) => {
        // Opening only changes 'opened'. A late response must not undo a newer trash/save.
        if (live)
          setW(
            (s) =>
              s && {
                ...s,
                documents: s.documents.map((d) =>
                  d.id === opened.id ? { ...d, opened: Math.max(d.opened, opened.opened) } : d,
                ),
              },
          );
      })
      .catch((e) => {
        if (live) notify(message(e), true);
      });
    return () => {
      live = false;
    };
  }, [route.id, w?.user.id, settingUp, notify]);
  function showPop(kind: Pop['kind'], e: React.MouseEvent, d?: Doc) {
    const r = e.currentTarget.getBoundingClientRect();
    setPop({ kind, anchor: { top: r.top, left: r.left, right: r.right, bottom: r.bottom }, d });
    if (kind === 'activity') {
      setSeen(true);
      void api<Workspace>('/workspace')
        .then((f) => setW((s) => s && { ...s, activity: f.activity }))
        .catch((e) => notify(message(e), true));
    }
  }
  async function patch(d: Doc, b: Partial<Doc>) {
    if (locks.current.has(d.id))
      throw new Error('A change is still saving. Please try again in a moment.');
    locks.current.add(d.id);
    // A newly trashed/restored row must not offer its inverse action while the
    // original write is still locked. Publish the acknowledged record, not a guess.
    try {
      upsert(await api<Doc>(`/documents/${d.id}`, 'PATCH', b));
    } finally {
      locks.current.delete(d.id);
    }
  }
  const apply = async (d: Doc, b: Partial<Doc>, msg: string, undo?: () => void) => {
    try {
      await patch(d, b);
      notify(msg, false, undo);
    } catch (e) {
      notify(message(e), true);
    }
  };
  const star = (d: Doc) =>
    void apply(d, { starred: !d.starred }, d.starred ? 'Removed from starred' : 'Added to starred');
  const restore = (d: Doc) => void apply(d, { trashed: false }, 'Document restored');
  const trash = async (d: Doc) => {
    await patch(d, { trashed: true });
    notify('Document moved to Trash', false, () => restore(d));
  };
  const updUser = async (p: Partial<User>) => {
    if (!w) return;
    const user = w.user;
    setW((s) => s && { ...s, user: { ...s.user, ...p } });
    try {
      const next = await api<User>('/settings', 'PATCH', p);
      setW((s) => s && { ...s, user: next });
      notify(p.theme ? 'Workspace theme updated' : 'Display name saved');
    } catch (e) {
      setW((s) => s && { ...s, user });
      throw e;
    }
  };
  useEffect(() => {
    // A separate OS reader can save a working copy while this WebView is suspended.
    // Refresh metadata, not the route/editor; a draft behind the reader stays mounted.
    const token = () => {
      try {
        return localStorage.getItem('ft:library-change');
      } catch {
        return null;
      }
    };
    let last = token(),
      live = true;
    const refresh = () => {
      const current = token();
      if (!current || current === last) return;
      last = current;
      void api<Workspace>('/workspace')
        .then((f) => {
          if (live && last === current)
            setW((s) =>
              s?.user.id === f.user.id ? { ...s, documents: f.documents, activity: f.activity } : s,
            );
        })
        .catch((e) => {
          last = null;
          if (live) notify(message(e), true);
        });
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('ft:resume', refresh);
    return () => {
      live = false;
      window.removeEventListener('storage', refresh);
      window.removeEventListener('ft:resume', refresh);
    };
  }, [notify]);
  if (!w) return <Boot error={error} retry={() => void load()} />;
  const profileSave = async (name: string, date: string) => {
    const user = await saveProfile(w.user, name, date);
    setW((s) => (s?.user.id === user.id ? { ...s, user } : s));
    if (!settingUp) notify('Profile saved');
  };
  if (settingUp) return <Welcome user={w.user} save={profileSave} />;
  const { view, id } = route,
    collections = w.collections,
    active = w.documents.filter((d) => !d.trashed),
    stars = active.filter((d) => d.starred).sort((a, b) => b.updated - a.updated),
    recent = [...active].sort((a, b) => b.updated - a.updated),
    last = [...active].sort((a, b) => b.opened - a.opened || b.updated - a.updated)[0],
    currentCollection = collections.find((c) => view === `collection/${c.id}`),
    isC = view.startsWith('collection/'),
    current = w.documents.find((d) => d.id === id && !d.trashed),
    title = isC ? currentCollection?.name || 'Collection not found' : views[view],
    context = currentCollection?.id || '',
    used = w.documents.reduce((a, d) => a + d.size, 0);
  const files =
    view === 'trash'
      ? w.documents.filter((d) => d.trashed)
      : view === 'starred'
        ? stars
        : isC
          ? active.filter((d) => d.collectionId === context)
          : active;
  const actions = {
    open,
    star,
    restore,
    menu: (d: Doc, e: React.MouseEvent) => showPop('doc', e, d),
  };
  const close = () => setDialog(null);
  const openNew = () => modal({ kind: 'new' });
  const switchWorkspace = (newW: Workspace) => {
    setW(newW);
    dirty.current = false;
    setSeen(false);
    nav('overview');
  };
  const sideLink = (v: View, text: string, icon: React.ReactNode, count?: number) => (
    <button
      className={`nav-item ${view === v ? 'selected' : ''}`}
      aria-current={view === v ? 'page' : undefined}
      onClick={() => nav(v)}
    >
      {icon}
      <span>{text}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
  const popAct = (label: string, icon: React.ReactNode, fn: () => void, danger = false) => (
    <button
      className={danger ? 'danger-text' : ''}
      onClick={() => {
        setPop(null);
        fn();
      }}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <>
      {id ? (
        <Suspense
          fallback={
            <div className="editor-loading">
              <Spin size={26} />
              Opening document…
            </div>
          }
        >
          {current ? (
            <Editor
              key={current.id}
              d={current}
              collection={collections.find((c) => c.id === current.collectionId)}
              close={() => nav(view)}
              backAction={editorBack}
              remove={() => modal({ kind: 'readerTrash', d: current })}
              onDirty={onDirty}
              onSaved={(d) => {
                upsert(d);
                notify('Changes saved');
              }}
              notify={notify}
            />
          ) : (
            <div className="missing-file">
              <Empty
                title="Document unavailable"
                body="It may have been moved to Trash or removed from this workspace."
                action={
                  <button className="btn primary" onClick={() => nav('documents')}>
                    Back to documents
                  </button>
                }
              />
            </div>
          )}
        </Suspense>
      ) : (
        <div className="app-shell">
          {drawer && (
            <button
              className="drawer-scrim"
              aria-label="Close navigation"
              onClick={() => setDrawer(false)}
            />
          )}
          <aside className={`sidebar ${drawer ? 'open' : ''}`} aria-label="Sidebar navigation">
            <div className="brand-row">
              <button
                className="brand-link"
                aria-label="Ft PDF overview"
                onClick={() => nav('overview')}
              >
                <Brand />
              </button>
              <button
                className="drawer-x icon-btn"
                onClick={() => setDrawer(false)}
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>
            <div className="sidebar-scroll">
              <div className="nav-label">WORKSPACE</div>
              <nav className="primary-nav">
                {sideLink('overview', 'Overview', <LayoutDashboard size={18} />)}
                {sideLink('documents', 'All documents', <FileStack size={18} />, active.length)}
                {sideLink('starred', 'Starred', <Star size={18} />)}
                {sideLink('trash', 'Trash', <Trash2 size={18} />)}
                {onDevice && (
                  <button className="nav-item" onClick={() => modal({ kind: 'toolbox' })}>
                    <Wrench size={18} />
                    <span>PDF toolbox</span>
                  </button>
                )}
              </nav>
              <div className="sidebar-line" />
              <div className="nav-label collection-label">
                COLLECTIONS
                <button
                  className="tiny-icon"
                  title="New collection"
                  aria-label="New collection"
                  onClick={() => modal({ kind: 'collection' })}
                >
                  <Plus size={15} />
                </button>
              </div>
              <nav className="collection-nav">
                {collections.map((c) => (
                  <button
                    key={c.id}
                    className={`nav-item folder-nav c-${c.color} ${currentCollection?.id === c.id ? 'selected' : ''}`}
                    aria-current={currentCollection?.id === c.id ? 'page' : undefined}
                    onClick={() => nav(`collection/${c.id}`)}
                  >
                    <Folder size={17} />
                    <span>{c.name}</span>
                  </button>
                ))}
                {!collections.length && (
                  <button
                    className="text-btn add-collection-link"
                    onClick={() => modal({ kind: 'collection' })}
                  >
                    Add a collection <Plus size={13} />
                  </button>
                )}
              </nav>
            </div>
            <div className="sidebar-bottom">
              <div className="storage">
                <div className="storage-title">
                  <HardDrive size={16} />
                  Workspace storage
                </div>
                <div
                  className="storage-track"
                  role="progressbar"
                  aria-label="Workspace storage used"
                  aria-valuenow={used}
                  aria-valuemin={0}
                  aria-valuemax={w.quota}
                >
                  <i style={{ width: used ? `max(4px,${(used / w.quota) * 100}%)` : 0 }} />
                </div>
                <p>
                  <strong>{sizeOf(used)}</strong> of {Math.round(w.quota / 1048576)} MB used
                </p>
              </div>
              {!onDevice && (
                <button
                  className="settings-link android-link"
                  onClick={() => modal({ kind: 'android' })}
                >
                  <Smartphone size={17} />
                  Android app
                  <ArrowUpRight size={13} />
                </button>
              )}
              <button className="settings-link" onClick={() => modal({ kind: 'settings' })}>
                <Settings2 size={17} />
                Settings
              </button>
              <button className="profile-btn" onClick={(e) => showPop('account', e)}>
                <span className="avatar">{initials(w.user.name)}</span>
                <span>
                  <strong>{w.user.name}</strong>
                  <small>{w.user.isGuest ? 'Guest workspace' : 'Personal account'}</small>
                </span>
                <ChevronsUpDown size={14} />
              </button>
            </div>
          </aside>
          <div className="main-column">
            <header className="topbar">
              <div className="breadcrumb">
                <button
                  className="mobile-menu icon-btn"
                  onClick={() => setDrawer(true)}
                  aria-label="Open navigation"
                >
                  <Menu size={21} />
                </button>
                <span className="crumb-icon">
                  <FolderOpen size={16} />
                </span>
                <span className="crumb-root">Workspace</span>
                <span className="mobile-wordmark">
                  Ft PDF<span>.</span>
                </span>
                <ChevronRight size={13} className="crumb-chevron" />
                <strong>{title}</strong>
              </div>
              <div className="topbar-tools">
                <button
                  className="global-search"
                  aria-label="Search documents"
                  onClick={() => modal({ kind: 'search' })}
                >
                  <Search size={16} />
                  <span>Search documents...</span>
                  <kbd>{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd>
                </button>
                <span className="top-divider" />
                <button
                  className="bell icon-btn"
                  title="Workspace activity"
                  aria-label="Workspace activity"
                  onClick={(e) => showPop('activity', e)}
                >
                  <Bell size={19} />
                  {!seen && w.activity.length > 0 && <i />}
                </button>
              </div>
            </header>
            <main className="main-content">
              <div className="page-intro">
                <div>
                  <div className="eyebrow intro-eyebrow">
                    <i />
                    {view === 'overview'
                      ? onDevice
                        ? 'ON THIS DEVICE'
                        : 'PERSONAL WORKSPACE'
                      : isC
                        ? 'COLLECTION'
                        : 'DOCUMENT LIBRARY'}
                  </div>
                  <h1>{view === 'overview' ? 'Workspace overview' : title}</h1>
                  <p>
                    {view === 'overview'
                      ? active.length
                        ? 'Your documents and collections, all in one place.'
                        : `Welcome, ${w.user.name}. Import a file or create your first document.`
                      : view === 'documents'
                        ? 'Browse, edit, and organize your document library.'
                        : view === 'starred'
                          ? 'Your go-to documents, always within reach.'
                          : view === 'trash'
                            ? 'Restore a document or permanently remove it from your workspace.'
                            : `${files.length} ${files.length === 1 ? 'document' : 'documents'} in this collection.`}
                  </p>
                </div>
                {view !== 'trash' && (!isC || currentCollection) && (
                  <div className="intro-actions">
                    {isC && (
                      <button
                        className="btn secondary square"
                        aria-label="Collection actions"
                        onClick={(e) => showPop('collection', e)}
                      >
                        <Ellipsis size={17} />
                      </button>
                    )}
                    <button className="btn secondary" onClick={() => modal({ kind: 'import' })}>
                      <Upload size={16} />
                      Import files
                    </button>
                    <button className="btn primary" onClick={openNew}>
                      <Plus size={17} />
                      New document
                    </button>
                  </div>
                )}
              </div>
              {view === 'overview' ? (
                <>
                  {onDevice && (
                    <Suspense fallback={<p role="status">Loading phone documents…</p>}>
                      <PhoneHome
                        key={w.user.id}
                        owner={w.user.id}
                        photos={() => modal({ kind: 'photos' })}
                        tools={() => modal({ kind: 'toolbox' })}
                        open={(d) => {
                          upsert(d);
                          nav('overview', d.id);
                        }}
                      />
                    </Suspense>
                  )}
                  <section className="resume-banner" aria-label="Last opened document">
                    <div className="hero-speckle" />
                    <div className="hero-copy">
                      <div className="resume-label">
                        <History size={13} />
                        {last ? 'LAST OPENED' : 'YOUR DOCUMENT STUDIO'}
                      </div>
                      <h2>{last ? last.name : 'Start your first document'}</h2>
                      <div className="hero-meta">
                        {last ? (
                          <>
                            <FileText size={13} />
                            <span>{labels[last.type]}</span>
                            <i />
                            {last.pages ? (
                              <>
                                <span>
                                  {last.pages} {last.pages === 1 ? 'page' : 'pages'}
                                </span>
                                <i />
                              </>
                            ) : null}
                            <span>
                              {collections.find((c) => c.id === last.collectionId)?.name ||
                                'Unfiled'}
                            </span>
                          </>
                        ) : (
                          <span>One space for PDFs, Word, text, and HTML.</span>
                        )}
                      </div>
                      <button
                        className="hero-button"
                        onClick={() => (last ? open(last) : openNew())}
                      >
                        {last ? 'Continue reading' : 'Create a document'}
                        <ArrowRight size={15} />
                      </button>
                    </div>
                    <PaperArt type={last?.type} />
                  </section>
                  <section className="dash-section">
                    <SectionTitle
                      title="Starred documents"
                      count={stars.length}
                      more={() => nav('starred')}
                    />
                    {stars.length ? (
                      <div className="card-grid overview-cards">
                        {stars.slice(0, 3).map((d) => (
                          <DocCard key={d.id} d={d} {...actions} />
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<Star />}
                        title="Keep your favorites here"
                        body="Star a document from your library to pin it here."
                        action={
                          <button className="text-btn" onClick={() => nav('documents')}>
                            Browse documents <ArrowRight size={14} />
                          </button>
                        }
                      />
                    )}
                  </section>
                  <section className="dash-section recent-section">
                    <SectionTitle
                      title="Recent documents"
                      more={() => nav('documents')}
                      label="All documents"
                    />
                    {recent.length ? (
                      <DocTable docs={recent.slice(0, 5)} collections={collections} {...actions} />
                    ) : (
                      <Empty
                        title="No recent documents"
                        body="Create or import a document to get started."
                      />
                    )}
                  </section>
                </>
              ) : isC && !currentCollection ? (
                <Empty
                  title="Collection not found"
                  body="This collection no longer exists."
                  action={
                    <button className="text-btn" onClick={() => nav('documents')}>
                      Go to all documents <ArrowRight size={14} />
                    </button>
                  }
                />
              ) : (
                <Library
                  key={view}
                  docs={files}
                  collections={collections}
                  view={view}
                  create={openNew}
                  all={() => nav('documents')}
                  {...actions}
                />
              )}
            </main>
          </div>
        </div>
      )}
      {pop && (
        <Popup anchor={pop.anchor} onClose={() => setPop(null)} wide={pop.kind === 'activity'}>
          {pop.kind === 'doc' && pop.d ? (
            ((d: Doc) => (
              <>
                <div className="popup-label">DOCUMENT ACTIONS</div>
                {d.trashed ? (
                  <>
                    {popAct('Restore document', <RotateCcw />, () => restore(d))}
                    {popAct(
                      'Delete permanently',
                      <Trash2 />,
                      () => modal({ kind: 'delete', d }),
                      true,
                    )}
                  </>
                ) : (
                  <>
                    {popAct('Open document', <ExternalLink />, () => open(d))}
                    {popAct('Rename', <Pencil />, () => modal({ kind: 'rename', d }))}
                    {popAct('Move to collection', <FolderInput />, () =>
                      modal({ kind: 'move', d }),
                    )}
                    {popAct(d.starred ? 'Remove from starred' : 'Add to starred', <Star />, () =>
                      star(d),
                    )}
                    {popAct(
                      onDevice ? 'Save a copy to Files' : 'Download file',
                      <Download />,
                      () => void downloadDoc(d).catch((e) => notify(message(e), true)),
                    )}
                    <hr />
                    {popAct(
                      'Move to Trash',
                      <Trash2 />,
                      () => void trash(d).catch((e) => notify(message(e), true)),
                      true,
                    )}
                  </>
                )}
              </>
            ))(pop.d)
          ) : pop.kind === 'collection' ? (
            <>
              {popAct('Edit collection', <Pencil />, () =>
                modal({ kind: 'collection', c: currentCollection }),
              )}
              {popAct(
                'Delete collection',
                <Trash2 />,
                () => modal({ kind: 'removeCollection', c: currentCollection }),
                true,
              )}
            </>
          ) : pop.kind === 'account' ? (
            <>
              <div className="popup-account">
                <strong>{w.user.name}</strong>
                <span>{w.user.email || 'Your guest workspace'}</span>
              </div>
              {w.user.isGuest ? (
                <>
                  {popAct('Create account', <UserRoundPlus />, () => modal({ kind: 'register' }))}
                  {popAct('Sign in', <LogIn />, () => modal({ kind: 'login' }))}
                </>
              ) : (
                popAct('Sign out', <LogOut />, () => modal({ kind: 'logout' }))
              )}
              <hr />
              {popAct('Workspace settings', <Palette />, () => modal({ kind: 'settings' }))}
            </>
          ) : (
            <>
              <div className="activity-head">
                <ActivityIcon size={16} />
                <strong>Workspace activity</strong>
              </div>
              <div className="activity-list">
                {!w.activity.length && <p className="muted">No activity yet.</p>}
                {w.activity.slice(0, 6).map((a) => (
                  <div key={a.id}>
                    <Clock3 size={14} />
                    <span>
                      {a.message}
                      <small>{ago(a.created)}</small>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Popup>
      )}
      {onDevice && (dialog?.kind === 'photos' || dialog?.kind === 'toolbox') && (
        <Suspense
          fallback={
            <div className="toast" role="status">
              <Spin />
              Opening tool…
            </div>
          }
        >
          {dialog.kind === 'photos' ? (
            <PhotoForm
              collections={collections}
              initial={context}
              close={close}
              done={(d) => {
                upsert(d);
                notify('Image PDF created');
                nav(view, d.id);
              }}
            />
          ) : (
            <Toolbox
              docs={active}
              close={close}
              photos={() => modal({ kind: 'photos' })}
              done={(d) => {
                upsert(d);
                notify('New document saved');
                nav(view, d.id);
              }}
            />
          )}
        </Suspense>
      )}
      {dialog?.kind === 'new' && (
        <NewForm
          photos={() => modal({ kind: 'photos' })}
          collections={collections}
          initial={context}
          onClose={close}
          onDone={(d) => {
            upsert(d);
            notify('Document created');
            open(d);
          }}
        />
      )}
      {dialog?.kind === 'import' && (
        <ImportForm
          collections={collections}
          initial={context}
          initialFiles={incoming}
          onClose={close}
          onFile={upsert}
          onDone={(n, c, only) => {
            nav(c ? `collection/${c}` : 'documents', n === 1 ? only?.id : undefined);
            notify(`${n} ${n === 1 ? 'file' : 'files'} imported`);
          }}
        />
      )}
      {dialog?.kind === 'search' && <SearchDialog docs={w.documents} open={open} close={close} />}
      {(dialog?.kind === 'rename' || dialog?.kind === 'move') && dialog.d && (
        <MetaForm
          mode={dialog.kind}
          d={dialog.d}
          collections={collections}
          onClose={close}
          save={async (b) => {
            await patch(dialog.d!, b);
            notify(dialog.kind === 'rename' ? 'Document renamed' : 'Document moved');
          }}
        />
      )}
      {dialog?.kind === 'collection' && (
        <CollectionForm
          c={dialog.c}
          onClose={close}
          onDone={(c) => {
            setW(
              (s) =>
                s && {
                  ...s,
                  collections: s.collections.some((x) => x.id === c.id)
                    ? s.collections.map((x) => (x.id === c.id ? c : x))
                    : [...s.collections, c],
                },
            );
            nav(`collection/${c.id}`);
            notify(dialog.c ? 'Collection updated' : 'Collection created');
          }}
        />
      )}
      {dialog?.kind === 'removeCollection' && dialog.c && (
        <Confirm
          title="Delete collection?"
          body={`“${dialog.c.name}” will be removed. Its documents will stay in All documents as unfiled files.`}
          label="Delete collection"
          onClose={close}
          onConfirm={async () => {
            const cid = dialog.c!.id;
            await api(`/collections/${cid}`, 'DELETE');
            setW(
              (s) =>
                s && {
                  ...s,
                  collections: s.collections.filter((c) => c.id !== cid),
                  documents: s.documents.map((d) =>
                    d.collectionId === cid ? { ...d, collectionId: null } : d,
                  ),
                },
            );
            nav('documents');
            notify('Collection deleted. Your documents were kept.');
          }}
        />
      )}
      {dialog?.kind === 'readerTrash' && dialog.d && (
        <Confirm
          title="Move document to Trash?"
          label="Move to Trash"
          body={`“${fileName(dialog.d)}” will be removed from this library. You can restore it from Trash. The original file outside Ft PDF is not deleted.`}
          onClose={close}
          onConfirm={async () => {
            await trash(dialog.d!);
            nav(view);
          }}
        />
      )}
      {dialog?.kind === 'delete' && dialog.d && (
        <Confirm
          title="Permanently delete document?"
          body={`“${fileName(dialog.d)}” will be deleted from this workspace. This cannot be undone.`}
          label="Delete permanently"
          onClose={close}
          onConfirm={async () => {
            const docId = dialog.d!.id;
            await api(`/documents/${docId}`, 'DELETE');
            setW((s) => s && { ...s, documents: s.documents.filter((d) => d.id !== docId) });
            notify('Document permanently deleted');
          }}
        />
      )}
      {dialog?.kind === 'tour' && (
        <Modal title="Workspace tour" kicker="GUIDED PRACTICE" onClose={close}>
          <div className="modal-body tour-replay">
            <p className="dialog-copy">
              Scroll the practice file, edit a line, or star it. Nothing here changes your library.
            </p>
            <PracticeFile />
            <button className="btn primary" onClick={close}>
              Finish tour
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'android' && <AndroidDialog close={close} />}
      {dialog?.kind === 'settings' && (
        <Settings
          user={w.user}
          update={updUser}
          profileSave={profileSave}
          tour={() => modal({ kind: 'tour' })}
          onClose={close}
          auth={() => modal({ kind: 'register' })}
          logout={() => modal({ kind: 'logout' })}
        />
      )}
      {(dialog?.kind === 'register' || dialog?.kind === 'login') && (
        <AuthForm
          initial={dialog.kind}
          onClose={close}
          onDone={(s) => {
            switchWorkspace(s);
            notify(
              dialog.kind === 'login'
                ? 'Welcome back'
                : 'Account created. Your workspace is saved.',
            );
          }}
        />
      )}
      {dialog?.kind === 'logout' && (
        <Confirm
          title="Sign out of Ft PDF?"
          body="Your documents are saved to your account. You’ll return to a separate guest workspace."
          label="Sign out"
          danger={false}
          onClose={close}
          onConfirm={async () => {
            switchWorkspace(await api<Workspace>('/auth/logout', 'POST'));
            notify('Signed out');
          }}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'err' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.msg}</span>
          {toast.undo && (
            <button
              className="undo"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
          <button
            className="toast-x"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
