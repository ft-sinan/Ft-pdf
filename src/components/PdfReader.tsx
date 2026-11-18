import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import { BookOpen } from 'lucide-react';
import { Spin } from './UI';
import { message } from '../types';

const GAP = 18,
  MAX_HEIGHT = 32000;
function pageAt(offsets: Float64Array, y: number) {
  let lo = 0,
    hi = offsets.length - 2;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Only pages around the viewport own canvases/text layers. A placeholder retains
 * measured dimensions after eviction, including rotated and mixed-size pages. */
function Page({
  pdf,
  n,
  width,
  height,
  measure,
  selectable,
}: {
  pdf: PDFDocumentProxy;
  n: number;
  width: number;
  height: number;
  selectable: boolean;
  measure: (n: number, ratio: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState('loading'),
    [attempt, retry] = useState(0);
  useEffect(() => {
    const el = host.current!;
    let live = true,
      page: PDFPageProxy | undefined,
      task: RenderTask | undefined,
      layer: TextLayer | undefined;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `PDF page ${n} of ${pdf.numPages}`);
    const text = document.createElement('div');
    text.className = 'read-text-layer';
    setState('loading');
    el.replaceChildren(canvas, text);
    (async () => {
      page = await pdf.getPage(n);
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      if (!(base.width > 0 && base.height > 0 && Number.isFinite(base.width + base.height)))
        throw Error('Invalid page size.');
      const ratio = base.height / base.width;
      measure(n, ratio);
      const view = page.getViewport({
        scale: Math.min(width / base.width, MAX_HEIGHT / base.height),
      });
      // Bound the bitmap even with extreme media boxes or a high-density phone display.
      const density = Math.min(
        devicePixelRatio || 1,
        2,
        8192 / Math.max(view.width, view.height),
        Math.sqrt(3200000 / (view.width * view.height)),
      );
      canvas.width = Math.max(1, Math.ceil(view.width * density));
      canvas.height = Math.max(1, Math.ceil(view.height * density));
      task = page.render({
        canvasContext: canvas.getContext('2d')!,
        viewport: view,
        transform: [density, 0, 0, density, 0, 0],
        background: 'white',
      });
      await task.promise;
      if (!live) return;
      canvas.dataset.rendered = 'true';
      setState('ready');
      if (selectable) {
        text.style.setProperty('--scale-factor', String(view.scale));
        layer = new TextLayer({
          container: text,
          viewport: view,
          textContentSource: page.streamTextContent(),
        });
        // An unavailable text layer need not prevent reading the rendered page.
        await layer.render().catch(() => {});
      }
    })().catch((e) => {
      if (live) setState(message(e));
    });
    return () => {
      live = false;
      task?.cancel();
      layer?.cancel();
      el.replaceChildren();
      canvas.width = canvas.height = 0;
      page?.cleanup();
    };
  }, [pdf, n, width, measure, attempt, selectable]);
  return (
    <section className="read-pdf-page" aria-label={`Page ${n}`} style={{ width, height }}>
      <div className="read-page-content" ref={host} />
      {state === 'loading' ? (
        <div className="read-page-status">
          <Spin size={18} />
          <span>Loading page {n}…</span>
        </div>
      ) : (
        state !== 'ready' && (
          <div className="read-page-status" role="alert">
            <span>{state}</span>
            <button className="btn secondary" onClick={() => retry((r) => r + 1)}>
              Retry page
            </button>
          </div>
        )
      )}
    </section>
  );
}
export default function PdfReader({
  pdf,
  initialPage,
  onPage,
  selectable,
}: {
  pdf: PDFDocumentProxy;
  initialPage: number;
  onPage: (page: number) => void;
  selectable: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    start = useRef(initialPage),
    frame = useRef(0),
    previous = useRef<Float64Array | null>(null);
  const [size, resize] = useState({ w: 0, h: 0 }),
    [scroll, at] = useState(0),
    [ratios, setRatios] = useState<Map<number, number>>(() => new Map());
  const measure = useCallback(
    (n: number, ratio: number) =>
      setRatios((old) => (old.get(n) === ratio ? old : new Map(old).set(n, ratio))),
    [],
  );
  useLayoutEffect(() => {
    const el = root.current!;
    const update = () =>
      resize((old) =>
        old.w === el.clientWidth && old.h === el.clientHeight
          ? old
          : { w: el.clientWidth, h: el.clientHeight },
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);
  const width = Math.max(1, Math.min(800, size.w - (size.w < 600 ? 24 : 72)));
  const offsets = useMemo(() => {
    const a = new Float64Array(pdf.numPages + 1),
      fallback = ratios.get(1) || 842 / 595;
    a[0] = GAP;
    for (let i = 1; i < a.length; i++)
      a[i] =
        a[i - 1] + Math.max(1, Math.min(MAX_HEIGHT, width * (ratios.get(i) || fallback))) + GAP;
    return a;
  }, [width, pdf.numPages, ratios]);
  // Keep the same point on the same page when a size estimate is replaced or the phone rotates.
  useLayoutEffect(() => {
    if (!size.w) return;
    const el = root.current!,
      old = previous.current;
    let y: number;
    if (old) {
      const i = pageAt(old, el.scrollTop),
        frac = (el.scrollTop - old[i]) / (old[i + 1] - old[i]);
      y = offsets[i] + frac * (offsets[i + 1] - offsets[i]);
    } else {
      const i = Math.max(0, Math.min(pdf.numPages - 1, start.current - 1));
      y = i ? offsets[i] - GAP : 0;
    }
    previous.current = offsets;
    el.scrollTop = y;
    at(el.scrollTop);
  }, [offsets, size.w, pdf.numPages]);
  const atEnd = scroll > 0 && scroll + size.h >= offsets[pdf.numPages] - 2;
  const page = atEnd ? pdf.numPages : pageAt(offsets, scroll + Math.min(size.h * 0.34, 240)) + 1;
  useEffect(() => {
    if (size.w) onPage(page);
  }, [page, size.w, onPage]);
  const first = pageAt(offsets, scroll - size.h * 0.55),
    last = pageAt(offsets, scroll + size.h * 1.55);
  return (
    <>
      <div
        className="read-pdf-scroll"
        ref={root}
        aria-label="Scrollable PDF"
        role="region"
        tabIndex={0}
        onScroll={() => {
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => {
            if (root.current) at(root.current.scrollTop);
          });
        }}
      >
        {size.w > 0 && (
          <div
            className="read-pages"
            style={{
              paddingTop: offsets[first],
              paddingBottom: offsets[pdf.numPages] - offsets[last + 1],
            }}
          >
            {Array.from({ length: last - first + 1 }, (_, j) => {
              const i = first + j;
              return (
                <Page
                  key={i}
                  n={i + 1}
                  pdf={pdf}
                  width={Math.min(width, MAX_HEIGHT / (ratios.get(i + 1) || 842 / 595))}
                  height={offsets[i + 1] - offsets[i] - GAP}
                  measure={measure}
                  selectable={selectable}
                />
              );
            })}
          </div>
        )}
      </div>
      <div className="reader-foot">
        <span>
          <BookOpen size={13} />
          Reading view
        </span>
        <span className="reader-page-count">
          Page {page} of {pdf.numPages}
        </span>
        <i aria-hidden="true" style={{ width: `${(100 * page) / pdf.numPages}%` }} />
      </div>
    </>
  );
}
