import { useRef, useState } from 'react';
import {
  Upload,
  Plus,
  Check,
  Trash2,
  FileUp,
  X,
  ArrowRight,
  Search,
  CornerDownLeft,
  Folder,
  ShieldCheck,
  Palette,
  Feather,
  UserRound,
} from 'lucide-react';
import {
  api,
  onDevice,
  Collection,
  Doc,
  fileName,
  Kind,
  kindNames,
  labels,
  message,
  sizeOf,
  Theme,
  User,
  Workspace,
} from '../types';
import { FileIcon } from './Art';
import CreatorSpace from './CreatorSpace';
import { ProfileFields, type ProfileSave } from './Welcome';
import { Empty, ErrorNote, Modal, Spin } from './UI';
export function CollectionField({
  collections,
  value,
  set,
}: {
  collections: Collection[];
  value: string;
  set: (id: string) => void;
}) {
  return (
    <label className="field">
      Collection
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Unfiled</option>
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function Footer({
  close,
  busy,
  label,
  icon,
  disabled = false,
}: {
  close: () => void;
  busy: boolean;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="modal-footer">
      <button type="button" className="btn secondary" onClick={close} disabled={busy}>
        Cancel
      </button>
      <button type="submit" className="btn primary" disabled={busy || disabled}>
        {busy ? <Spin /> : icon}
        {label}
      </button>
    </div>
  );
}
export function NewForm({
  photos,
  collections,
  initial,
  onClose,
  onDone,
}: {
  collections: Collection[];
  initial: string;
  onClose: () => void;
  photos: () => void;
  onDone: (d: Doc) => void;
}) {
  const [name, setName] = useState(''),
    [type, setType] = useState<Kind>('pdf'),
    [paper, setPaper] = useState('a4'),
    [text, setText] = useState(''),
    [c, setC] = useState(initial),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState('');
  return (
    <Modal
      title="New document"
      kicker="DOCUMENT STUDIO"
      subtitle="Choose a format and give your document a name."
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            onDone(
              await api<Doc>('/documents', 'POST', {
                name,
                type,
                collectionId: c || null,
                ...(onDevice && type === 'pdf' ? { paper, text } : {}),
              }),
            );
          } catch (e) {
            setErr(message(e));
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <div className="field">
            File format
            <div className="format-options">
              {(['pdf', 'docx', 'txt', 'html'] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={type === k ? 'selected' : ''}
                  aria-label={kindNames[k]}
                  aria-pressed={type === k}
                  onClick={() => setType(k)}
                >
                  <FileIcon type={k} />
                  {kindNames[k]}
                </button>
              ))}
            </div>
          </div>
          {onDevice && type === 'pdf' && (
            <button className="btn secondary" type="button" onClick={photos}>
              <FileUp size={16} />
              Create from images
            </button>
          )}
          <label className="field">
            Document name
            <div className="input-affix">
              <input
                required
                maxLength={onDevice && type === 'pdf' ? 120 : 140}
                placeholder="Untitled document"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <span>.{type}</span>
            </div>
          </label>
          {onDevice && type === 'pdf' && (
            <>
              <label className="field">
                Page size
                <select value={paper} onChange={(e) => setPaper(e.target.value)}>
                  <option value="a4">A4</option>
                  <option value="letter">US Letter</option>
                </select>
              </label>
              <label className="field">
                Page text{' '}
                <textarea
                  className="pdf-draft"
                  placeholder="Start with text, or leave blank"
                  maxLength={50000}
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
            </>
          )}
          <CollectionField collections={collections} value={c} set={setC} />
          <ErrorNote text={err} />
        </div>
        <Footer
          close={onClose}
          busy={busy}
          label={onDevice && type === 'pdf' ? 'Create PDF' : 'Create document'}
          icon={<Plus size={16} />}
        />
      </form>
    </Modal>
  );
}
export const accepted = '.pdf,.doc,.docx,.txt,.html,.htm';
export function ImportForm({
  collections,
  initial,
  initialFiles,
  onClose,
  onFile,
  onDone,
}: {
  collections: Collection[];
  initial: string;
  initialFiles: File[];
  onClose: () => void;
  onFile: (d: Doc) => void;
  onDone: (n: number, c: string, only?: Doc) => void;
}) {
  const [files, setFiles] = useState<File[]>(initialFiles),
    [c, setC] = useState(initial),
    [done, setDone] = useState(0),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState(''),
    [drag, setDrag] = useState(false),
    input = useRef<HTMLInputElement>(null),
    total = useRef(0),
    last = useRef<Doc | undefined>(undefined);
  const add = (arr: File[]) => {
    if (busy) return;
    const good = arr.filter(
      (f) => /\.(pdf|docx?|txt|html?)$/i.test(f.name) && f.size <= 25 * 1024 * 1024,
    );
    setErr(
      good.length === arr.length
        ? ''
        : 'Only PDF, Word, TXT, and HTML files up to 25 MB can be imported.',
    );
    setFiles((prev) => [
      ...prev,
      ...good.filter(
        (g) =>
          !prev.some(
            (p) => p.name === g.name && p.size === g.size && p.lastModified === g.lastModified,
          ),
      ),
    ]);
  };
  const process = async () => {
    setBusy(true);
    setErr('');
    setDone(0);
    const failed: File[] = [],
      errors: string[] = [];
    for (const f of files) {
      try {
        const body = new FormData();
        body.append('file', f);
        body.append('name', f.name);
        body.append('collectionId', c);
        last.current = await api<Doc>('/documents/import', 'POST', body);
        onFile(last.current);
        total.current++;
      } catch (e) {
        failed.push(f);
        errors.push(`${f.name}: ${message(e)}`);
      }
      setDone((x) => x + 1);
    }
    setBusy(false);
    if (!failed.length) onDone(total.current, c, last.current);
    else {
      setFiles(failed);
      setErr(errors.join(' '));
    }
  };
  return (
    <Modal
      title="Import files"
      kicker="ADD TO WORKSPACE"
      subtitle="Bring your existing documents into Ft PDF."
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void process();
        }}
      >
        <div className="modal-body">
          <input
            hidden
            type="file"
            multiple
            accept={accepted}
            ref={input}
            onChange={(e) => {
              add(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className={`dropzone ${drag ? 'over' : ''}`}
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              add(Array.from(e.dataTransfer.files));
            }}
          >
            <span className="drop-icon">
              <FileUp size={24} />
            </span>
            <strong>
              Choose files <span>or drag them here</span>
            </strong>
            <small>PDF, DOCX, DOC, TXT, HTML · Up to 25 MB each</small>
          </button>
          {!!files.length && (
            <div className="import-list">
              {files.map((f, i) => (
                <div key={`${i}-${f.name}`}>
                  <FileIcon
                    type={
                      (/\.docx?$/i.test(f.name)
                        ? 'docx'
                        : /\.htm/i.test(f.name)
                          ? 'html'
                          : f.name.split('.').pop()?.toLowerCase()) as Kind
                    }
                    small
                  />
                  <span>
                    <strong>{f.name}</strong>
                    <small>
                      {sizeOf(f.size)}
                      {f.name.toLowerCase().endsWith('.doc') ? ' · Converts to DOCX' : ''}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${f.name}`}
                    disabled={busy}
                    onClick={() => setFiles((a) => a.filter((_, j) => i !== j))}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <CollectionField collections={collections} value={c} set={setC} />
          {busy && (
            <p className="muted" role="status">
              Importing {Math.min(done + 1, files.length)} of {files.length}…
            </p>
          )}
          <ErrorNote text={err} />
        </div>
        <Footer
          close={onClose}
          busy={busy}
          label={`Import ${files.length || ''} ${files.length === 1 ? 'file' : 'files'}`.replace(
            '  ',
            ' ',
          )}
          icon={<Upload size={15} />}
          disabled={!files.length}
        />
      </form>
    </Modal>
  );
}
export function MetaForm({
  mode,
  d,
  collections,
  save,
  onClose,
}: {
  mode: 'rename' | 'move';
  d: Doc;
  collections: Collection[];
  save: (patch: Partial<Doc>) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(d.name),
    [c, setC] = useState(d.collectionId || ''),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState('');
  return (
    <Modal
      title={mode === 'rename' ? 'Rename document' : 'Move document'}
      subtitle={fileName(d)}
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await save(mode === 'rename' ? { name: name.trim() } : { collectionId: c || null });
            onClose();
          } catch (e) {
            setErr(message(e));
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          {mode === 'rename' ? (
            <label className="field">
              Document name
              <div className="input-affix">
                <input
                  required
                  maxLength={140}
                  value={name}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setName(e.target.value)}
                />
                <span>.{d.type}</span>
              </div>
            </label>
          ) : (
            <CollectionField collections={collections} value={c} set={setC} />
          )}
          <ErrorNote text={err} />
        </div>
        <Footer
          close={onClose}
          busy={busy}
          label={mode === 'rename' ? 'Save name' : 'Move document'}
        />
      </form>
    </Modal>
  );
}
export function CollectionForm({
  c,
  onClose,
  onDone,
}: {
  c?: Collection;
  onClose: () => void;
  onDone: (c: Collection) => void;
}) {
  const [name, setName] = useState(c?.name || ''),
    [color, setColor] = useState(c?.color || 'rose'),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState('');
  return (
    <Modal
      title={c ? 'Edit collection' : 'New collection'}
      subtitle="Keep related documents together in a collection."
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            onDone(
              await api<Collection>(`/collections${c ? `/${c.id}` : ''}`, c ? 'PATCH' : 'POST', {
                name,
                color,
              }),
            );
          } catch (e) {
            setErr(message(e));
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <label className="field">
            Collection name
            <input
              value={name}
              required
              maxLength={64}
              placeholder="e.g. Studio projects"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="field">
            Folder color
            <div className="color-options">
              {['rose', 'gold', 'sage', 'blue', 'plum', 'stone'].map((k) => (
                <button
                  key={k}
                  type="button"
                  title={k}
                  aria-label={`${k} folder`}
                  aria-pressed={color === k}
                  className={`c-${k} ${color === k ? 'active' : ''}`}
                  onClick={() => setColor(k)}
                >
                  {color === k ? <Check size={20} /> : <Folder size={20} />}
                </button>
              ))}
            </div>
          </div>
          <ErrorNote text={err} />
        </div>
        <Footer
          close={onClose}
          busy={busy}
          label={c ? 'Save changes' : 'Create collection'}
          icon={<Folder size={15} />}
        />
      </form>
    </Modal>
  );
}
export function Confirm({
  title,
  body,
  label,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  label: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState('');
  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <div className="modal-body">
        <p className="dialog-copy">{body}</p>
        <ErrorNote text={err} />
      </div>
      <div className="modal-footer">
        <button className="btn secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className={`btn ${danger ? 'danger' : 'primary'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setErr(message(e));
              setBusy(false);
            }
          }}
        >
          {busy ? <Spin /> : danger ? <Trash2 size={15} /> : null}
          {label}
        </button>
      </div>
    </Modal>
  );
}
export function AuthForm({
  initial,
  onClose,
  onDone,
}: {
  initial: 'login' | 'register';
  onClose: () => void;
  onDone: (w: Workspace) => void;
}) {
  const [mode, setMode] = useState(initial),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      kicker="FT PDF ACCOUNT"
      title={mode === 'register' ? 'Make this workspace yours' : 'Welcome back'}
      subtitle={
        onDevice
          ? mode === 'register'
            ? 'Keep this library in a password-protected profile on this device. No cloud sync.'
            : 'Sign in to a profile saved on this device.'
          : mode === 'register'
            ? 'Create an account to keep this workspace and access it on your other devices.'
            : 'Sign in to your personal document workspace.'
      }
      onClose={() => !busy && onClose()}
    >
      <form
        key={mode}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          const data = Object.fromEntries(new FormData(e.currentTarget));
          try {
            onDone(await api<Workspace>(`/auth/${mode}`, 'POST', data));
          } catch (e) {
            setErr(message(e));
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          {mode === 'register' && (
            <label className="field">
              Your name
              <input
                name="name"
                required
                maxLength={64}
                autoComplete="name"
                placeholder="Your display name"
              />
            </label>
          )}
          <label className="field">
            Email address
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          <label className="field">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={mode === 'register' ? 8 : 1}
              maxLength={256}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'}
            />
          </label>
          <ErrorNote text={err} />
          <button className="btn primary full" disabled={busy}>
            {busy ? <Spin /> : <ShieldCheck size={16} />}
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
          <p className="auth-switch">
            {mode === 'register' ? 'Already have an account?' : 'New to Ft PDF?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'register' ? 'login' : 'register');
                setErr('');
              }}
            >
              {mode === 'register' ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>
      </form>
    </Modal>
  );
}
export const themeOptions: { id: Theme; name: string; desc: string; colors: string[] }[] = [
  {
    id: 'terracotta',
    name: 'Terracotta',
    desc: 'Warm clay on cream',
    colors: ['#ab4536', '#e9b9a2', '#fbf8f1'],
  },
  {
    id: 'espresso',
    name: 'Espresso',
    desc: 'Rich coffee tones',
    colors: ['#704b34', '#caa77e', '#f5ecde'],
  },
  {
    id: 'forest',
    name: 'Forest',
    desc: 'Sage and evergreen',
    colors: ['#3e6853', '#a4bc9f', '#f5f7ed'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    desc: 'A softer dark mode',
    colors: ['#db9c7d', '#56514f', '#262726'],
  },
];
export function Settings({
  user,
  profileSave,
  tour,
  onClose,
  update,
  auth,
  logout,
}: {
  user: User;
  profileSave: ProfileSave;
  tour: () => void;
  onClose: () => void;
  update: (patch: Partial<User>) => Promise<void>;
  auth: () => void;
  logout: () => void;
}) {
  const [tab, setTab] = useState<'appearance' | 'account' | 'creator'>('appearance'),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const save = async (p: Partial<User>) => {
    setBusy(true);
    setErr('');
    try {
      await update(p);
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Workspace settings" kicker="PREFERENCES" onClose={onClose}>
      <div className="settings-tabs">
        <button
          aria-pressed={tab === 'appearance'}
          className={tab === 'appearance' ? 'active' : ''}
          onClick={() => setTab('appearance')}
        >
          <Palette size={15} />
          Appearance
        </button>
        <button
          aria-pressed={tab === 'account'}
          className={tab === 'account' ? 'active' : ''}
          onClick={() => setTab('account')}
        >
          <UserRound size={15} />
          Account
        </button>
        <button
          aria-pressed={tab === 'creator'}
          className={tab === 'creator' ? 'active' : ''}
          onClick={() => setTab('creator')}
        >
          <Feather size={15} />
          Creator Space
        </button>
      </div>
      <div className="modal-body">
        {tab === 'creator' ? (
          <CreatorSpace />
        ) : tab === 'appearance' ? (
          <>
            <div className="setting-intro">
              <h3>Workspace theme</h3>
              <p>Choose a palette that feels like you.</p>
            </div>
            <div className="theme-grid">
              {themeOptions.map((t) => (
                <button
                  key={t.id}
                  disabled={busy}
                  aria-pressed={user.theme === t.id}
                  className={`theme-choice ${user.theme === t.id ? 'selected' : ''}`}
                  onClick={() => void save({ theme: t.id })}
                >
                  <div className="theme-swatches">
                    {t.colors.map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}
                  </div>
                  <strong>
                    {t.name}
                    {user.theme === t.id && <Check size={14} />}
                  </strong>
                  <span>{t.desc}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="account-info">
              <span className="account-icon">
                <UserRound size={22} />
              </span>
              <div>
                <strong>{user.isGuest ? 'Guest workspace' : 'Personal account'}</strong>
                <p>
                  {user.email ||
                    (onDevice
                      ? 'Create a profile on this device.'
                      : 'Create an account to sync across devices.')}
                </p>
              </div>
            </div>
            <ProfileFields user={user} save={profileSave} />
            <button className="text-btn" onClick={tour}>
              Replay the tour <ArrowRight size={14} />
            </button>
            <button className="text-btn" onClick={user.isGuest ? auth : logout}>
              {user.isGuest ? 'Create an account' : 'Sign out'}
              <ArrowRight size={14} />
            </button>
          </>
        )}
        {onDevice && tab !== 'creator' && (
          <p className="pwa-tip">
            <strong>On this device.</strong> Files and accounts stay on this phone. Save a copy to
            Android Files to back it up.
          </p>
        )}
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}
export function SearchDialog({
  docs,
  open,
  close,
}: {
  docs: Doc[];
  open: (d: Doc) => void;
  close: () => void;
}) {
  const [q, setQ] = useState(''),
    [index, setIndex] = useState(0);
  const found = docs
    .filter((d) => !d.trashed && fileName(d).toLocaleLowerCase().includes(q.toLocaleLowerCase()))
    .sort((a, b) => b.opened - a.opened);
  return (
    <Modal title="Search documents" onClose={close} className="search-dialog">
      <div className="search-input">
        <Search size={20} />
        <input
          data-autofocus
          placeholder="Find a document by name or format…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found[index]) open(found[index]);
            if (['ArrowDown', 'ArrowUp'].includes(e.key) && found.length) {
              e.preventDefault();
              const next = (index + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
              setIndex(next);
              document.getElementById(`result-${next}`)?.scrollIntoView({ block: 'nearest' });
            }
          }}
        />
      </div>
      <div className="result-caption">
        {q ? `${found.length} matching documents` : 'RECENTLY OPENED'}
      </div>
      <div className="search-results">
        {found.map((d, i) => (
          <button
            key={d.id}
            id={`result-${i}`}
            className={i === index ? 'selected' : ''}
            onClick={() => open(d)}
            onMouseEnter={() => setIndex(i)}
          >
            <FileIcon type={d.type} small />
            <span>
              <strong>{fileName(d)}</strong>
              <small>{labels[d.type]}</small>
            </span>
            {i === index && <CornerDownLeft size={14} />}
          </button>
        ))}
        {!found.length && (
          <Empty
            title="No documents found"
            body="Try another title or file extension."
            icon={<Search />}
          />
        )}
      </div>
      <div className="search-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> to navigate
        </span>
        <span>
          <kbd>↵</kbd> to open
        </span>
      </div>
    </Modal>
  );
}
