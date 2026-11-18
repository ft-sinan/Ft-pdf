import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  Files,
  LockKeyhole,
  Scissors,
  FileOutput,
  Stamp,
  Layers,
  Eye,
  Search,
  Plus,
  X,
} from 'lucide-react';
import { Modal, ErrorNote, Spin } from './UI';
import {
  catalog,
  descriptions,
  accepts,
  matching,
  multiple,
  ranged,
  type Tool,
} from '../tools/catalog';
import type { Options } from '../tools/run';
import type { Box } from '../tools/pages';
import { Doc, message, sizeOf } from '../types';
import { privateRead, exportResult, rpc, store } from '../device/bridge';
import { Redactor, SignaturePad } from './ToolMark';
const icons = {
  Create: FileOutput,
  Organize: Scissors,
  Optimize: Layers,
  Convert: Files,
  'Mark up': Stamp,
  Privacy: LockKeyhole,
  Review: Eye,
};
export default function Toolbox({
  docs,
  close,
  photos,
  done,
}: {
  docs: Doc[];
  close: () => void;
  photos: () => void;
  done: (d: Doc) => void;
}) {
  const [tool, choose] = useState<Tool | null>(null),
    [q, search] = useState('');
  if (tool)
    return (
      <Job key={tool} tool={tool} docs={docs} back={() => choose(null)} close={close} done={done} />
    );
  const list = catalog.filter((t) => t.slice(1).join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal
      title="PDF toolbox"
      kicker="WORKS OFFLINE"
      subtitle="Make a new copy. Your source documents stay untouched."
      wide
      onClose={close}
    >
      <div className="modal-body tool-library">
        <label className="phone-search">
          <Search size={16} />
          <input
            placeholder="Find a PDF tool…"
            aria-label="Find a PDF tool"
            value={q}
            onChange={(e) => search(e.target.value)}
          />
        </label>
        {Object.entries(icons).map(([group, Icon]) => {
          const rows = list.filter((t) => t[2] === group);
          return (
            rows.length > 0 && (
              <section key={group}>
                <h3>{group}</h3>
                <div className="tool-grid">
                  {rows.map(([id, name, , detail]) => (
                    <button
                      key={id}
                      aria-label={name}
                      onClick={() => (id === 'photos' ? photos() : choose(id))}
                    >
                      <Icon size={19} />
                      <span>
                        <strong>{name}</strong>
                        <small>{detail}</small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </section>
            )
          );
        })}
        {!list.length && <p>No tools match this search.</p>}
        <details className="offline-note">
          <summary>What’s supported offline?</summary>
          <p>
            OCR recognizes English. Office conversions work with text, values or page images rather
            than recreating a complex layout. Signatures are handwritten marks. Certified PDF/A,
            translation and remote signing are not included. No documents are uploaded.
          </p>
        </details>
      </div>
    </Modal>
  );
}
function Job({
  tool,
  docs,
  back,
  close,
  done,
}: {
  tool: Tool;
  docs: Doc[];
  back: () => void;
  close: () => void;
  done: (d: Doc) => void;
}) {
  const spec = descriptions[tool],
    [files, setFiles] = useState<File[]>([]),
    [name, title] = useState(''),
    [range, pages] = useState(''),
    [value, setValue] = useState(tool === 'crop' ? '18' : tool === 'watermark' ? 'DRAFT' : ''),
    [mode, select] = useState(tool === 'rotate' ? '90' : 'structural'),
    [position, place] = useState('right'),
    [signature, sign] = useState(''),
    [boxes, mark] = useState<Box[]>([]),
    [err, error] = useState(''),
    [progress, work] = useState(''),
    [saved, report] = useState('');
  const ctrl = useRef<AbortController | null>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const multi = multiple(tool),
    candidates = docs.filter((d) => !d.trashed && matching(tool, d.name + '.' + d.type));
  function add(a: File[]) {
    if (!a.length) return;
    try {
      if (a.some((f) => !matching(tool, f.name) || f.size > 25 * 1048576))
        throw Error('Choose a supported file under 25 MB.');
      const next = multi ? [...files, ...a] : a.slice(0, 1);
      if (
        next.length > (tool === 'compare' ? 2 : 32) ||
        next.reduce((s, f) => s + f.size, 0) > 90 * 1048576
      )
        throw Error(
          tool === 'compare' ? 'Choose exactly two PDFs.' : 'Use up to 32 files and 90 MB per job.',
        );
      setFiles(next);
      mark([]);
      error('');
      report('');
      if (!name)
        title(
          (next[0].name.replace(/\.[^.]+$/, '') + ' - ' + spec.name.replace(/[^\w -]/g, '')).slice(
            0,
            115,
          ),
        );
    } catch (e) {
      error(message(e));
    }
  }
  async function library(id: string) {
    const d = candidates.find((d) => d.id === id);
    if (!d) return;
    work('Reading file…');
    try {
      add([
        new File(
          [await (await privateRead(`/device-file/${d.id}/file`)).blob()],
          d.name + '.' + d.type,
        ),
      ]);
    } catch (e) {
      error(message(e));
    } finally {
      work('');
    }
  }
  async function run() {
    if (ctrl.current) return;
    error('');
    report('');
    work('Preparing…');
    const c = new AbortController();
    ctrl.current = c;
    try {
      const { runTool } = await import('../tools/run');
      const opts: Options = { range, value, mode, position, signature, boxes };
      const result = await runTool(tool, files, opts, work, c.signal);
      if (c.signal.aborted) throw Error('Operation cancelled.');
      if ('text' in result) {
        work('Saving PDF…');
        done(await rpc<Doc>('pdf.create', { type: 'pdf', name, text: result.text }));
      } else if (result.ext === 'pdf' || result.ext === 'docx') {
        work('Saving to library…');
        done(
          await store<Doc>(
            { name, type: result.ext, pages: result.pages || null, locked: !!result.locked },
            result.bytes,
            result.content || '',
          ),
        );
      } else {
        work('Choose a destination in Files…');
        report(
          (await exportResult(name, result.ext, result.bytes))
            ? `${name}.${result.ext} saved to Files.`
            : 'Export cancelled. Your inputs are still here.',
        );
      }
    } catch (e) {
      error(message(e));
    } finally {
      ctrl.current = null;
      work('');
    }
  }
  function move(i: number, j: number) {
    const next = [...files];
    [next[i], next[j]] = [next[j], next[i]];
    setFiles(next);
  }
  return (
    <Modal
      title={spec.name}
      kicker={`${spec.group.toUpperCase()} · OFFLINE`}
      subtitle={spec.detail}
      wide={tool === 'redact'}
      onClose={() => !progress && close()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="modal-body">
          <button type="button" className="text-btn" onClick={back} disabled={!!progress}>
            <ArrowLeft size={14} />
            All tools
          </button>
          <fieldset disabled={!!progress} className="tool-fields">
            <div className="tool-inputs">
              <label className="field">
                From your library
                <select
                  aria-label="Add a library file"
                  value=""
                  onChange={(e) => void library(e.target.value)}
                >
                  <option value="">Select a document…</option>
                  {candidates.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}.{d.type}
                    </option>
                  ))}
                </select>
              </label>
              <input
                ref={input}
                type="file"
                hidden
                accept={accepts(tool)}
                multiple={multi}
                onChange={(e) => {
                  add(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn secondary"
                onClick={() => input.current?.click()}
              >
                <Plus size={15} />
                Choose from Files
              </button>
            </div>
            <ol className="job-list">
              {files.map((f, i) => (
                <li key={i}>
                  <span>
                    <strong>
                      {i + 1}. {f.name}
                    </strong>
                    <small>{sizeOf(f.size)}</small>
                  </span>
                  {multi && (
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={'Move file ' + (i + 1) + ' up'}
                        disabled={!i}
                        onClick={() => move(i, i - 1)}
                      >
                        <ArrowUp />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={'Move file ' + (i + 1) + ' down'}
                        disabled={i === files.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        <ArrowDown />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={'Remove file ' + (i + 1)}
                    onClick={() => {
                      setFiles(files.filter((_, j) => j !== i));
                      mark([]);
                    }}
                  >
                    <X />
                  </button>
                </li>
              ))}
            </ol>
            {(ranged(tool) || tool === 'split') && (
              <label className="field">
                {tool === 'split' ? 'Parts' : tool === 'remove' ? 'Pages to remove' : 'Pages'}
                <input
                  aria-label="Page ranges"
                  value={range}
                  onChange={(e) => pages(e.target.value)}
                  placeholder={
                    tool === 'split'
                      ? '1-3; 4-6'
                      : tool === 'remove'
                        ? 'e.g. 2, 4-5'
                        : 'All pages, or e.g. 1, 3-5'
                  }
                />
                {tool === 'split' && (
                  <small>Separate parts with semicolons. Leave blank for one PDF per page.</small>
                )}
              </label>
            )}
            {tool === 'rotate' && (
              <label className="field">
                Clockwise rotation
                <select value={mode} onChange={(e) => select(e.target.value)}>
                  {['90', '180', '270'].map((v) => (
                    <option key={v} value={v}>
                      {v}°
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tool === 'compress' && (
              <label className="field">
                Method
                <select value={mode} onChange={(e) => select(e.target.value)}>
                  <option value="structural">Structural · keep text and vectors</option>
                  <option value="image">Small images · flatten text, links and forms</option>
                </select>
              </label>
            )}
            {['crop', 'watermark', 'protect', 'unlock'].includes(tool) && (
              <label className="field">
                {tool === 'crop'
                  ? 'Margin to trim (points)'
                  : tool === 'watermark'
                    ? 'Watermark text'
                    : tool === 'unlock'
                      ? 'Existing authorized password'
                      : 'New opening password'}
                <input
                  type={tool === 'crop' ? 'number' : tool === 'watermark' ? 'text' : 'password'}
                  required
                  autoComplete="off"
                  maxLength={tool === 'watermark' ? 100 : 128}
                  minLength={tool === 'protect' ? 8 : 1}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
            )}
            {tool === 'sign' && (
              <>
                <SignaturePad set={sign} />
                <label className="field">
                  Placement
                  <select value={position} onChange={(e) => place(e.target.value)}>
                    <option value="right">Bottom right</option>
                    <option value="left">Bottom left</option>
                  </select>
                </label>
              </>
            )}
            {tool === 'redact' && files[0] && (
              <Redactor file={files[0]} boxes={boxes} mark={mark} />
            )}
            <label className="field">
              Output name
              <input
                required
                maxLength={115}
                value={name}
                onChange={(e) => title(e.target.value)}
                placeholder="Name your new copy"
              />
            </label>
          </fieldset>
          <small className="muted">
            {['split', 'tojpg', 'toexcel', 'toslides'].includes(tool)
              ? 'Choose where to export the result in Android Files.'
              : 'The result is saved as a new document in your library.'}{' '}
            Existing digital signatures do not carry over.
          </small>
          <ErrorNote text={err} />
          {(progress || saved) && <p role="status">{progress || saved}</p>}
        </div>
        <div className="modal-footer">
          {!progress ? (
            <button type="button" className="btn secondary" onClick={close}>
              Close
            </button>
          ) : (
            <button
              type="button"
              className="btn secondary"
              disabled={
                !ctrl.current ||
                progress.startsWith('Choose a destination') ||
                progress.startsWith('Saving')
              }
              onClick={() => {
                ctrl.current?.abort();
                work('Stopping after current step…');
              }}
            >
              Stop
            </button>
          )}
          <button
            className="btn primary"
            disabled={
              !!progress ||
              !files.length ||
              (multi && files.length < 2) ||
              !name.trim() ||
              (tool === 'redact' && !boxes.length) ||
              (tool === 'sign' && !signature)
            }
          >
            {progress ? <Spin /> : <FileOutput size={15} />}Run tool
          </button>
        </div>
      </form>
    </Modal>
  );
}
