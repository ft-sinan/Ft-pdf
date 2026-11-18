import { useState } from 'react';
import {
  Star,
  Ellipsis,
  RotateCcw,
  ArrowRight,
  List,
  LayoutGrid,
  SlidersHorizontal,
  Trash2,
  FilePlus2,
  Plus,
  Folder,
  ChevronDown,
} from 'lucide-react';
import { ago, Collection, Doc, fileName, Kind, kindNames, sizeOf } from '../types';
import { DocCard, FileIcon } from './Art';
import { Empty } from './UI';
export type RowActions = {
  open: (d: Doc) => void;
  star: (d: Doc) => void;
  menu: (d: Doc, e: React.MouseEvent) => void;
  restore: (d: Doc) => void;
};
export function SectionTitle({
  title,
  count,
  more,
  label = 'View all',
}: {
  title: string;
  count?: number;
  more?: () => void;
  label?: string;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {count !== undefined && <span className="count">{count}</span>}
      </div>
      {more && (
        <button className="text-btn" onClick={more}>
          {label}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
export function DocTable({
  docs,
  collections,
  open,
  star,
  menu,
  restore,
}: { docs: Doc[]; collections: Collection[] } & RowActions) {
  return (
    <div className="table-frame">
      <table className="doc-table">
        <thead>
          <tr>
            <th>Document name</th>
            <th className="col-collection">Collection</th>
            <th className="col-date">Last edited</th>
            <th className="actions-col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const c = collections.find((c) => c.id === d.collectionId);
            return (
              <tr key={d.id}>
                <td>
                  <button
                    className="row-open"
                    onClick={(e) => (d.trashed ? menu(d, e) : open(d))}
                    aria-label={`${d.trashed ? 'Actions for' : 'Open'} ${fileName(d)}`}
                  >
                    <FileIcon type={d.type} />
                    <span>
                      <strong>{fileName(d)}</strong>
                      <small>
                        {kindNames[d.type]} <i>·</i> {sizeOf(d.size)}
                      </small>
                    </span>
                  </button>
                </td>
                <td className="col-collection">
                  {c ? (
                    <span className={`collection-tag c-${c.color}`}>
                      <i />
                      {c.name}
                    </span>
                  ) : (
                    <span className="muted">Unfiled</span>
                  )}
                </td>
                <td className="col-date">{ago(d.updated)}</td>
                <td>
                  <div className="row-actions">
                    {d.trashed ? (
                      <button
                        className="icon-btn"
                        onClick={() => restore(d)}
                        title="Restore document"
                        aria-label={`Restore ${d.name}`}
                      >
                        <RotateCcw size={16} />
                      </button>
                    ) : (
                      <button
                        className={`row-star icon-btn ${d.starred ? 'on' : ''}`}
                        onClick={() => star(d)}
                        title={d.starred ? 'Remove from starred' : 'Star document'}
                        aria-label={`${d.starred ? 'Unstar' : 'Star'} ${d.name}`}
                      >
                        <Star size={15} fill={d.starred ? 'currentColor' : 'none'} />
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      aria-label={`Actions for ${d.name}`}
                      onClick={(e) => menu(d, e)}
                    >
                      <Ellipsis size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function Library({
  docs,
  collections,
  view,
  create,
  all,
  ...actions
}: {
  docs: Doc[];
  collections: Collection[];
  view: string;
  create: () => void;
  all: () => void;
} & RowActions) {
  const [type, setType] = useState<Kind | 'all'>('all'),
    [sort, setSort] = useState('recent'),
    [layout, setLayout] = useState<'list' | 'grid'>(() =>
      localStorage.getItem('ft-layout') === 'grid' ? 'grid' : 'list',
    );
  const files = docs
    .filter((d) => type === 'all' || d.type === type)
    .sort((a, b) =>
      sort === 'name'
        ? fileName(a).localeCompare(fileName(b))
        : sort === 'size'
          ? b.size - a.size
          : b.updated - a.updated,
    );
  if (!docs.length)
    return (
      <Empty
        title={
          view === 'trash'
            ? 'Trash is empty'
            : view === 'starred'
              ? 'No starred documents yet'
              : 'A fresh start'
        }
        body={
          view === 'trash'
            ? 'Documents you move to Trash will appear here until you restore or delete them.'
            : view === 'starred'
              ? 'Star a document to keep it within easy reach.'
              : 'Create your first document or import a file into this space.'
        }
        icon={view === 'trash' ? <Trash2 /> : view === 'starred' ? <Star /> : <Folder />}
        action={
          view === 'trash' ? undefined : (
            <button className="btn secondary" onClick={view === 'starred' ? all : create}>
              {view === 'starred' ? (
                <>
                  Browse documents <ArrowRight size={15} />
                </>
              ) : (
                <>
                  <Plus size={16} />
                  New document
                </>
              )}
            </button>
          )
        }
      />
    );
  return (
    <>
      <div className="library-toolbar">
        <div className="filter-tabs" aria-label="Filter by file type">
          {(['all', 'pdf', 'docx', 'txt', 'html'] as const).map((k) => (
            <button
              key={k}
              className={type === k ? 'active' : ''}
              onClick={() => setType(k)}
              aria-pressed={type === k}
            >
              {k === 'all' ? 'All files' : kindNames[k]}
            </button>
          ))}
        </div>
        <div className="library-tools">
          <label className="sort">
            <SlidersHorizontal size={14} />
            <select
              value={sort}
              aria-label="Sort documents"
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">Last edited</option>
              <option value="name">Name A–Z</option>
              <option value="size">Largest first</option>
            </select>
            <ChevronDown size={12} />
          </label>
          {view !== 'trash' && (
            <div className="layout-toggle">
              {(['list', 'grid'] as const).map((v) => (
                <button
                  key={v}
                  aria-label={`${v} view`}
                  aria-pressed={v === layout}
                  className={v === layout ? 'active' : ''}
                  onClick={() => {
                    setLayout(v);
                    localStorage.setItem('ft-layout', v);
                  }}
                >
                  {v === 'list' ? <List size={16} /> : <LayoutGrid size={15} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {!files.length ? (
        <Empty
          icon={<FilePlus2 />}
          title="No matching files"
          body="Try a different file type to see more documents."
          action={
            <button className="text-btn" onClick={() => setType('all')}>
              Show all files <ArrowRight size={14} />
            </button>
          }
        />
      ) : layout === 'grid' && view !== 'trash' ? (
        <div className="card-grid library-grid">
          {files.map((d) => (
            <DocCard key={d.id} d={d} {...actions} />
          ))}
        </div>
      ) : (
        <DocTable docs={files} collections={collections} {...actions} />
      )}
      <div className="file-count">
        {files.length} {files.length === 1 ? 'document' : 'documents'}
      </div>
    </>
  );
}
