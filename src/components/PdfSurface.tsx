import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Files,
  Hand,
  Highlighter,
  Minus,
  PenLine,
  Plus,
  Redo2,
  Type,
  Undo2,
  LockKeyhole,
  Check,
} from 'lucide-react';
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { Doc, readPdf, message } from '../types';
import PdfReader from './PdfReader';
import { Empty, ErrorNote, Modal, Spin } from './UI';
GlobalWorkerOptions.workerSrc = workerURL;
const PdfTools = lazy(() => import('./PdfTools'));
type Pt = { x: number; y: number };
type Tool = 'hand' | 'text' | 'highlight' | 'pen';
type Mark = {
  page: number;
  type: Exclude<Tool, 'hand'>;
  points: Pt[];
  color: string;
  text?: string;
  size: number;
};
export type PdfHandle = { exportFile: () => Promise<Blob> };
const colors = ['#333831', '#ad493b', '#426b94', '#57836a'];
const highlights = ['#f3c84c', '#a2cb83', '#f0a4a6', '#89bfe4'];
function Marks({ m }: { m: Mark }) {
  const a = m.points[0],
    b = m.points.at(-1)!;
  if (m.type === 'text')
    return (
      <text x={a.x} y={a.y} fontSize={m.size} fontFamily="Document Sans, sans-serif" fill={m.color}>
        {(m.text || '').split('\n').map((s, i) => (
          <tspan key={i} x={a.x} dy={i ? m.size * 1.25 : 0}>
            {s || ' '}
          </tspan>
        ))}
      </text>
    );
  if (m.type === 'highlight')
    return (
      <rect
        x={Math.min(a.x, b.x)}
        y={Math.min(a.y, b.y)}
        width={Math.abs(b.x - a.x)}
        height={Math.abs(b.y - a.y)}
        fill={m.color}
        fillOpacity=".42"
      />
    );
  return (
    <polyline
      points={m.points.map((p) => `${p.x},${p.y}`).join(' ')}
      fill="none"
      stroke={m.color}
      strokeWidth={m.size}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}
const PdfSurface = forwardRef<
  PdfHandle,
  {
    d: Doc;
    revision: number;
    source?: (signal: AbortSignal) => Promise<Response>;
    onProtection?: (locked: boolean) => void;
    editing: boolean;
    busy: boolean;
    onDirty: (b: boolean) => void;
    onReady: (b: boolean) => void;
    commit: (blob: Blob) => Promise<void>;
  }
>(function PdfSurface(
  { d, revision, source, onProtection, editing, busy, onDirty, onReady, commit },
  ref,
) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [loading, setLoading] = useState(true),
    [rendering, setRendering] = useState(false),
    [err, setErr] = useState(''),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(620),
    [base, setBase] = useState({ width: 595, height: 842 }),
    [tool, setTool] = useState<Tool>('hand'),
    [color, setColor] = useState(colors[0]),
    [hl, setHl] = useState(highlights[0]),
    [size, setSize] = useState(16),
    [marks, setMarks] = useState<Mark[]>([]),
    [undone, setUndone] = useState<Mark[]>([]),
    [draft, setDraft] = useState<Mark | null>(null),
    [at, setAt] = useState<Pt | null>(null),
    [text, setText] = useState(''),
    [password, setPassword] = useState(''),
    [pw, setPw] = useState<{
      send: (s: string) => void;
      incorrect: boolean;
      cancel: () => void;
    } | null>(null),
    [retry, setRetry] = useState(0);
  const [manage, setManage] = useState(false);
  const original = useRef<Uint8Array<ArrayBuffer> | null>(null),
    surface = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    draftRef = useRef<Mark | null>(null),
    svg = useRef<SVGSVGElement>(null);
  const shown = Math.max(110, Math.min(742, width - (width < 500 ? 26 : 72))) * zoom;
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    let task: ReturnType<typeof getDocument> | undefined;
    setLoading(true);
    setPdf(null);
    setErr('');
    setMarks([]);
    setUndone([]);
    onReady(false);
    setPw(null);
    (async () => {
      const r = source ? await source(abort.signal) : await readPdf(d, revision, abort.signal);
      if (!r.ok) throw new Error('The PDF could not be loaded.');
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!live) return;
      original.current = bytes;
      task = getDocument({
        data: bytes.slice(),
        cMapUrl: '/pdf-assets/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdf-assets/fonts/',
        isEvalSupported: false,
      });
      let challenged = false;
      task.onPassword = (send: (password: string) => void, reason: number) => {
        if (live) {
          challenged = true;
          onProtection?.(true);
          setPassword('');
          setPw({
            send,
            incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
            cancel: () => {
              void task?.destroy();
              setPw(null);
              setErr('A password is required to view this PDF.');
              setLoading(false);
            },
          });
        }
      };
      const p = await task.promise;
      if (!live) return;
      if (onProtection) {
        const encrypted =
          challenged ||
          (await p
            .getMetadata()
            .then((m) => !!(m.info as { EncryptFilterName?: string }).EncryptFilterName)
            .catch(() => true));
        if (!live) return;
        onProtection(encrypted);
      }
      setPw(null);
      setPdf(p);
      setPage((n) => Math.max(1, Math.min(n, p.numPages)));
      setLoading(false);
      onReady(true);
    })().catch((e) => {
      if (live) {
        setErr(message(e));
        setLoading(false);
        setPw(null);
      }
    });
    return () => {
      live = false;
      abort.abort();
      void task?.destroy();
    };
  }, [d.id, revision, retry, onReady, source, onProtection]);
  useEffect(() => {
    onDirty(editing && marks.length > 0);
  }, [editing, marks.length, onDirty]);
  useEffect(() => {
    if (!editing) {
      setMarks([]);
      setUndone([]);
      setAt(null);
      setDraft(null);
      draftRef.current = null;
      setTool('hand');
      setManage(false);
    }
  }, [editing]);
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setWidth(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);
  useEffect(() => {
    if (!editing || !pdf || !canvas.current) return;
    let live = true;
    let task: RenderTask | undefined;
    setRendering(true);
    (async () => {
      const p = await pdf.getPage(page);
      if (!live || !canvas.current) return;
      const base = p.getViewport({ scale: 1 }),
        viewport = p.getViewport({ scale: shown / base.width });
      setBase({ width: base.width, height: base.height });
      const c = canvas.current,
        dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.ceil(viewport.width * dpr);
      c.height = Math.ceil(viewport.height * dpr);
      task = p.render({
        canvasContext: c.getContext('2d')!,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      await task.promise;
      if (live) setRendering(false);
    })().catch((e) => {
      if (live && e.name !== 'RenderingCancelledException') {
        setErr(message(e));
        setRendering(false);
      }
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [editing, pdf, page, shown]);
  useEffect(() => {
    surface.current?.scrollTo(0, 0);
  }, [page]);
  const exportFile = useCallback(async () => {
    if (!original.current || !pdf) throw new Error('Wait for the PDF to finish loading.');
    if (!marks.length) return new Blob([original.current], { type: 'application/pdf' });
    const { PDFDocument, rgb, degrees, LineCapStyle } = await import('pdf-lib'),
      saved = await PDFDocument.load(original.current);
    let font;
    if (marks.some((m) => m.type === 'text')) {
      const [fk, r] = await Promise.all([
        import('@pdf-lib/fontkit'),
        fetch('/fonts/document-sans.ttf'),
      ]);
      if (!r.ok) throw new Error('The annotation font could not be loaded. Try saving again.');
      saved.registerFontkit(fk.default);
      font = await saved.embedFont(await r.arrayBuffer(), { subset: true });
    }
    for (const m of marks) {
      const target = saved.getPage(m.page - 1),
        source = await pdf.getPage(m.page),
        vp = source.getViewport({ scale: 1 });
      const conv = ({ x, y }: Pt) => {
          const [px, py] = vp.convertToPdfPoint(x, y);
          return { x: px, y: py };
        },
        ink = rgb(
          ...([1, 3, 5].map((i) => parseInt(m.color.slice(i, i + 2), 16) / 255) as [
            number,
            number,
            number,
          ]),
        );
      const pts = m.points.map(conv);
      if (m.type === 'text' && font) {
        const a = m.points[0],
          next = conv({ x: a.x + 1, y: a.y });
        const angle = (Math.atan2(next.y - pts[0].y, next.x - pts[0].x) * 180) / Math.PI;
        (m.text || '').split('\n').forEach((line, i) =>
          target.drawText(line, {
            ...conv({ x: a.x, y: a.y + i * m.size * 1.25 }),
            font,
            size: m.size,
            color: ink,
            rotate: degrees(angle),
          }),
        );
      } else if (m.type === 'highlight') {
        const a = pts[0],
          b = pts.at(-1)!;
        target.drawRectangle({
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
          color: ink,
          opacity: 0.42,
        });
      } else {
        for (let i = 1; i < pts.length; i++)
          target.drawLine({
            start: pts[i - 1],
            end: pts[i],
            thickness: m.size,
            color: ink,
            lineCap: LineCapStyle.Round,
          });
      }
    }
    return new Blob([new Uint8Array(await saved.save())], { type: 'application/pdf' });
  }, [pdf, marks]);
  useImperativeHandle(ref, () => ({ exportFile }), [exportFile]);
  const add = (m: Mark) => {
    setMarks((a) => [...a, m]);
    setUndone([]);
  };
  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(base.width, ((e.clientX - r.left) / r.width) * base.width)),
      y: Math.max(0, Math.min(base.height, ((e.clientY - r.top) / r.height) * base.height)),
    };
  };
  const undo = () => {
    if (!marks.length) return;
    setUndone((a) => [...a, marks.at(-1)!]);
    setMarks((a) => a.slice(0, -1));
  };
  const redo = () => {
    if (!undone.length) return;
    setMarks((a) => [...a, undone.at(-1)!]);
    setUndone((a) => a.slice(0, -1));
  };
  const tools = [
    ['hand', 'Browse', Hand],
    ['text', 'Text', Type],
    ['highlight', 'Highlight', Highlighter],
    ['pen', 'Draw', PenLine],
  ] as const;
  return (
    <div className="pdf-workspace">
      {editing && (
        <div className="editor-tools pdf-tools">
          <div className="tool-group">
            <button
              className="icon-btn"
              aria-label="Previous page"
              disabled={page <= 1 || !pdf}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="page-indicator">
              {page} <i>/</i> {pdf?.numPages || '–'}
            </span>
            <button
              className="icon-btn"
              aria-label="Next page"
              disabled={!pdf || page >= pdf.numPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <i className="tool-sep" />
          <div className="tool-group">
            {tools.map(([k, label, I]) => (
              <button
                key={k}
                className={`tool-button ${tool === k ? 'active' : ''}`}
                title={label}
                aria-label={label}
                aria-pressed={tool === k}
                disabled={busy || !pdf || (d.locked && k !== 'hand')}
                onClick={() => setTool(k)}
              >
                <I size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <i className="tool-sep" />
          <div className="tool-group">
            <button
              className="icon-btn"
              title="Undo annotation"
              aria-label="Undo annotation"
              disabled={!marks.length || busy}
              onClick={undo}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon-btn"
              title="Redo annotation"
              aria-label="Redo annotation"
              disabled={!undone.length || busy}
              onClick={redo}
            >
              <Redo2 size={16} />
            </button>
          </div>
          <button
            className="tool-button pdf-manage"
            title="Organize pages and fill forms"
            aria-label="PDF tools"
            disabled={busy || d.locked || !pdf}
            onClick={() => setManage(true)}
          >
            <Files size={16} />
            <span>PDF tools</span>
          </button>
          <div className="zoom-tools tool-group">
            <button
              className="icon-btn"
              aria-label="Zoom out"
              disabled={zoom <= 0.5}
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            >
              <Minus size={15} />
            </button>
            <button className="zoom-percent" title="Fit to width" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="icon-btn"
              aria-label="Zoom in"
              disabled={zoom >= 2}
              onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
      )}
      {editing && tool !== 'hand' && (
        <div className="context-bar">
          <span>
            {tool === 'text'
              ? 'Tap the page to place text.'
              : tool === 'highlight'
                ? 'Drag over a passage to highlight it.'
                : 'Draw directly on the page.'}
          </span>
          <div className="ink-options">
            {(tool === 'highlight' ? highlights : colors).map((c) => (
              <button
                key={c}
                aria-label={`Use color ${c}`}
                aria-pressed={c === (tool === 'highlight' ? hl : color)}
                style={{ background: c }}
                onClick={() => (tool === 'highlight' ? setHl(c) : setColor(c))}
              >
                {c === (tool === 'highlight' ? hl : color) && <Check size={10} />}
              </button>
            ))}
          </div>
          {tool === 'text' && (
            <select
              aria-label="Text size"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            >
              {[10, 12, 16, 20, 24, 32].map((s) => (
                <option key={s} value={s}>
                  {s} pt
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {d.locked && (
        <div className="protected-note">
          <LockKeyhole size={14} />
          Protected PDF · Read-only
        </div>
      )}
      {!editing && pdf && !loading && !err ? (
        <PdfReader pdf={pdf} initialPage={page} onPage={setPage} selectable={!d.locked} />
      ) : (
        <div className="pdf-scroll" ref={surface}>
          {err ? (
            <div className="editor-issue">
              <Empty
                title="Could not display PDF"
                body={err}
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
              Opening PDF…
            </div>
          ) : (
            editing &&
            pdf && (
              <div className="pdf-sheet-wrap" style={{ minWidth: shown + 24 }}>
                <div
                  className={`pdf-sheet mode-${tool}`}
                  style={{ width: shown, aspectRatio: `${base.width}/${base.height}` }}
                >
                  <canvas ref={canvas} aria-label={`PDF page ${page} of ${pdf?.numPages}`} />
                  <svg
                    ref={svg}
                    className="annotation-layer"
                    viewBox={`0 0 ${base.width} ${base.height}`}
                    style={{
                      pointerEvents: tool === 'hand' || busy || rendering ? 'none' : 'auto',
                      touchAction: tool === 'hand' ? 'auto' : 'none',
                    }}
                    onPointerDown={(e) => {
                      if (tool === 'hand' || e.button !== 0 || busy) return;
                      const p = point(e);
                      if (tool === 'text') {
                        setAt(p);
                        setText('');
                        return;
                      }
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const m: Mark = {
                        type: tool,
                        page,
                        points: [p, p],
                        color: tool === 'highlight' ? hl : color,
                        size: 2,
                      };
                      draftRef.current = m;
                      setDraft(m);
                    }}
                    onPointerMove={(e) => {
                      const m = draftRef.current;
                      if (!m) return;
                      const p = point(e),
                        next = {
                          ...m,
                          points: m.type === 'highlight' ? [m.points[0], p] : [...m.points, p],
                        };
                      draftRef.current = next;
                      setDraft(next);
                    }}
                    onPointerUp={(e) => {
                      const m = draftRef.current;
                      if (!m) return;
                      const p = point(e);
                      if (
                        Math.hypot(p.x - m.points[0].x, p.y - m.points[0].y) > 1 ||
                        m.points.length > 3
                      )
                        add({
                          ...m,
                          points: m.type === 'highlight' ? [m.points[0], p] : [...m.points, p],
                        });
                      draftRef.current = null;
                      setDraft(null);
                    }}
                    onPointerCancel={() => {
                      draftRef.current = null;
                      setDraft(null);
                    }}
                  >
                    {marks
                      .filter((m) => m.page === page)
                      .map((m, i) => (
                        <Marks key={i} m={m} />
                      ))}
                    {draft && <Marks m={draft} />}
                  </svg>
                  {rendering && (
                    <span className="page-rendering">
                      <Spin size={14} />
                    </span>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}
      {editing && (
        <div className="editor-foot">
          <span>PDF DOCUMENT</span>
          <span>
            {marks.length
              ? `${marks.length} pending ${marks.length === 1 ? 'annotation' : 'annotations'}`
              : 'Original page layout'}
          </span>
        </div>
      )}
      {editing && manage && (
        <Suspense
          fallback={
            <Modal title="PDF tools" onClose={() => setManage(false)}>
              <div className="modal-body">
                <Spin />
              </div>
            </Modal>
          }
        >
          <PdfTools
            load={exportFile}
            commit={commit}
            close={() => setManage(false)}
            hasMarks={marks.length > 0}
            saveLabel={source ? 'Save a library copy' : undefined}
          />
        </Suspense>
      )}
      {editing && at && (
        <Modal
          title="Add text to page"
          subtitle="Text will be embedded in the PDF when you save."
          onClose={() => setAt(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) add({ type: 'text', page, points: [at], text, color, size });
              setAt(null);
            }}
          >
            <div className="modal-body">
              <label className="field">
                Annotation
                <textarea
                  data-autofocus
                  className="pdf-text-field"
                  required
                  maxLength={2500}
                  value={text}
                  placeholder="Type your text…"
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn secondary" onClick={() => setAt(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={!text.trim()}>
                <Plus size={15} />
                Place text
              </button>
            </div>
          </form>
        </Modal>
      )}
      {pw && (
        <Modal
          title="Unlock PDF"
          subtitle="Enter the document password to view this protected file."
          onClose={pw.cancel}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pw.send(password);
              setPw(null);
            }}
          >
            <div className="modal-body">
              <label className="field">
                Document password
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <ErrorNote
                text={pw.incorrect ? 'That password did not unlock this file. Try again.' : ''}
              />
              <button className="btn primary">Unlock document</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
});
export default PdfSurface;
