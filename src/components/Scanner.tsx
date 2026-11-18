import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, Check, Crop, RotateCw, Trash2 } from 'lucide-react';
import { CaptureGate, fullFrame, validQuad, type Quad } from '../tools/pageDetection';
import { type ScanPage, straighten } from '../tools/scanPages';
import { MB, photoPdf } from '../tools/photos';
import { message } from '../types';
import { ErrorNote, Modal, Spin } from './UI';
import LiveCamera, { Lines } from './LiveCamera';
import './scanner.css';

const corners = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
function Corners({
  page,
  apply,
  cancel,
  busy,
}: {
  page: ScanPage;
  apply: (q: Quad) => void;
  cancel: () => void;
  busy: boolean;
}) {
  const [quad, change] = useState<Quad>(page.quad),
    [url, src] = useState(''),
    frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const u = URL.createObjectURL(page.source);
    src(u);
    return () => URL.revokeObjectURL(u);
  }, [page.source]);
  function move(i: number, x: number, y: number) {
    change(
      (q) =>
        q.map((p, j) =>
          i === j ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : p,
        ) as Quad,
    );
  }
  const valid = validQuad(quad);
  return (
    <>
      <div className="modal-body scan-crop">
        <p>
          Drag each handle to a corner of the paper. You can also focus a handle and use the arrow
          keys.
        </p>
        <div className="scan-view">
          <div ref={frame} className="scan-frame">
            {url && <img src={url} alt="Original camera frame" />}
            <Lines quad={quad} />
            {quad.map((p, i) => (
              <button
                disabled={busy}
                key={i}
                aria-label={corners[i] + ' corner'}
                className="corner-handle"
                style={{ left: 100 * p.x + '%', top: 100 * p.y + '%' }}
                onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId) || !frame.current) return;
                  const r = frame.current.getBoundingClientRect();
                  move(i, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
                }}
                onKeyDown={(e) => {
                  const d = 0.005;
                  if (!e.key.startsWith('Arrow')) return;
                  e.preventDefault();
                  move(
                    i,
                    p.x + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0),
                    p.y + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0),
                  );
                }}
              />
            ))}
          </div>
        </div>
        <button className="text-btn" disabled={busy} onClick={() => change(fullFrame())}>
          Use whole frame
        </button>
        <ErrorNote text={valid ? '' : 'Keep the corners in order around the page.'} />
      </div>
      <div className="modal-footer">
        <button className="btn secondary" disabled={busy} onClick={cancel}>
          Back to review
        </button>
        <button className="btn primary" disabled={busy || !valid} onClick={() => apply(quad)}>
          {busy ? <Spin /> : <Check size={16} />}Apply crop
        </button>
      </div>
    </>
  );
}
function checkSize(pages: ScanPage[]) {
  if (
    pages.length > 32 ||
    pages.reduce((s, p) => s + p.jpeg.size, 0) > 24 * MB ||
    pages.reduce((s, p) => s + p.source.size, 0) > 32 * MB
  )
    throw Error('This scan is full. Finish this PDF or remove a page before adding more.');
}
export default function Scanner({
  close,
  finish,
  after,
  saveCopy = false,
}: {
  close: () => void;
  finish: (pdf: Blob, count: number, name: string) => Promise<void>;
  after?: number;
  saveCopy?: boolean;
}) {
  const [pages, set] = useState<ScanPage[]>([]),
    [review, showReview] = useState(false),
    [retake, replace] = useState<number | null>(null),
    [crop, adjust] = useState<number | null>(null),
    [discard, ask] = useState(false),
    [work, busy] = useState(''),
    [err, fail] = useState(''),
    [name, rename] = useState('Scanned document');
  const gate = useRef(new CaptureGate()),
    pending = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const exit = () => {
    if (pending.current) return;
    if (discard) {
      ask(false);
      return;
    }
    if (crop !== null) {
      adjust(null);
      return;
    }
    if (pages.length) {
      showReview(true);
      ask(true);
      replace(null);
    } else close();
  };
  async function accept(source: Blob, q: Quad) {
    if (pending.current) return;
    pending.current = true;
    busy('Preparing page…');
    fail('');
    try {
      const index = retake ?? pages.length,
        p = await straighten(source, q, `Page ${index + 1}`);
      if (!alive.current) return;
      const next = [...pages];
      next[index] = p;
      checkSize(next);
      set(next);
      if (retake !== null || next.length === 32) {
        replace(null);
        showReview(true);
      }
    } finally {
      pending.current = false;
      if (alive.current) busy('');
    }
  }
  async function apply(q: Quad) {
    if (crop === null || pending.current) return;
    pending.current = true;
    busy('Straightening…');
    fail('');
    try {
      const old = pages[crop],
        p = await straighten(old.source, q, old.name),
        next = [...pages];
      next[crop] = { ...p, turn: old.turn };
      checkSize(next);
      set(next);
      adjust(null);
    } catch (e) {
      fail(message(e));
    } finally {
      pending.current = false;
      busy('');
    }
  }
  async function save() {
    if (pending.current || !pages.length) return;
    pending.current = true;
    busy('Saving PDF…');
    fail('');
    try {
      const pdf = await photoPdf(pages, 'original', false);
      await finish(pdf, pages.length, name.trim() || 'Scanned document');
    } catch (e) {
      fail(message(e));
    } finally {
      pending.current = false;
      if (alive.current) busy('');
    }
  }
  function move(i: number, delta: number) {
    const next = [...pages],
      j = i + delta;
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  }
  const count = `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`;
  return (
    <Modal
      title={
        discard
          ? 'Discard this scan?'
          : crop !== null
            ? 'Adjust corners'
            : review
              ? 'Review scan'
              : retake !== null
                ? `Retake page ${retake + 1}`
                : 'Scan document'
      }
      kicker="CAMERA SCANNER"
      className="scanner"
      onClose={exit}
    >
      {discard ? (
        <>
          <div className="modal-body">
            <p>These {count} haven’t been saved. Your existing documents won’t change.</p>
          </div>
          <div className="modal-footer">
            <button className="btn secondary" onClick={() => ask(false)}>
              Keep reviewing
            </button>
            <button className="btn primary" onClick={close}>
              Discard scan
            </button>
          </div>
        </>
      ) : crop !== null ? (
        <Corners page={pages[crop]} busy={!!work} apply={apply} cancel={() => adjust(null)} />
      ) : (
        <>
          <div className="modal-body scan-body">
            {review ? (
              <>
                <p className="scan-summary">
                  {count} in this scan
                  {after !== undefined ? ` · Insert after PDF page ${after}` : ''}
                </p>
                <ol className="scan-pages">
                  {pages.map((p, i) => (
                    <li key={i}>
                      <img
                        alt={`Scanned page ${i + 1}`}
                        src={p.thumb}
                        style={{ transform: `rotate(${p.turn}deg)` }}
                      />
                      <div>
                        <strong>Page {i + 1}</strong>
                        <div className="scan-row-buttons">
                          <button
                            disabled={!!work}
                            aria-label={`Adjust corners of page ${i + 1}`}
                            onClick={() => {
                              adjust(i);
                              fail('');
                            }}
                          >
                            <Crop />
                          </button>
                          <button
                            disabled={!!work}
                            aria-label={`Retake page ${i + 1}`}
                            onClick={() => {
                              gate.current = new CaptureGate();
                              replace(i);
                              showReview(false);
                              fail('');
                            }}
                          >
                            <Camera />
                          </button>
                          <button
                            disabled={!!work}
                            aria-label={`Rotate scanned page ${i + 1}`}
                            onClick={() =>
                              set(
                                pages.map((x, j) =>
                                  j === i ? { ...x, turn: (x.turn + 90) % 360 } : x,
                                ),
                              )
                            }
                          >
                            <RotateCw />
                          </button>
                          <button
                            disabled={!!work || !i}
                            aria-label={`Move page ${i + 1} up`}
                            onClick={() => move(i, -1)}
                          >
                            <ArrowUp />
                          </button>
                          <button
                            disabled={!!work || i + 1 === pages.length}
                            aria-label={`Move page ${i + 1} down`}
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDown />
                          </button>
                          <button
                            disabled={!!work}
                            aria-label={`Remove scanned page ${i + 1}`}
                            onClick={() => {
                              set(pages.filter((_, j) => j !== i));
                              gate.current = new CaptureGate();
                              fail('');
                            }}
                          >
                            <Trash2 />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                {after === undefined && (
                  <label className="field">
                    PDF name
                    <input
                      value={name}
                      maxLength={120}
                      disabled={!!work}
                      onChange={(e) => rename(e.target.value)}
                    />
                  </label>
                )}
                <p className="scan-privacy">
                  {after === undefined
                    ? 'Saving creates a PDF in this library.'
                    : saveCopy
                      ? 'Saving creates an edited library copy; the file in Files stays unchanged.'
                      : 'Saving inserts these pages and includes your current annotations.'}
                </p>
              </>
            ) : (
              <>
                <LiveCamera gate={gate.current} accept={accept} />
                {!!pages.length && (
                  <div className="scan-strip" aria-label="Captured pages">
                    {pages.map((p, i) => (
                      <img key={i} src={p.thumb} alt={`Captured page ${i + 1}`} />
                    ))}
                  </div>
                )}
                <p className="scan-privacy">
                  Frames stay on this device. Nothing is saved until you finish.
                </p>
              </>
            )}
            {work && <p role="status">{work}</p>}
          </div>
          <div className="modal-footer">
            {review ? (
              <>
                <button
                  className="btn secondary"
                  disabled={!!work || pages.length >= 32}
                  onClick={() => {
                    replace(null);
                    showReview(false);
                    fail('');
                  }}
                >
                  Scan more
                </button>
                <button
                  className="btn primary"
                  disabled={!pages.length || !!work}
                  onClick={() => void save()}
                >
                  {work ? <Spin /> : <Check size={16} />}{' '}
                  {after === undefined
                    ? 'Create scanned PDF'
                    : saveCopy
                      ? 'Save inserted copy'
                      : 'Save inserted pages'}
                </button>
              </>
            ) : (
              <>
                <small className="scan-count" aria-live="polite">
                  {count}
                </small>
                <button className="btn secondary" disabled={!!work} onClick={exit}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  disabled={!pages.length || !!work}
                  onClick={() => {
                    showReview(true);
                    replace(null);
                  }}
                >
                  Review pages
                </button>
              </>
            )}
          </div>
        </>
      )}
      <ErrorNote text={err} />
    </Modal>
  );
}
