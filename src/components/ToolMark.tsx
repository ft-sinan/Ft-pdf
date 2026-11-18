import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Undo2 } from 'lucide-react';
import type { Box } from '../tools/pages';
import { openPdf, render } from '../tools/pdfview';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { message } from '../types';
import { ErrorNote, Spin } from './UI';
export function SignaturePad({ set }: { set: (s: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null),
    pen = useRef(false);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget,
      b = c.getBoundingClientRect();
    return [
      ((e.clientX - b.left) * c.width) / b.width,
      ((e.clientY - b.top) * c.height) / b.height,
    ] as const;
  };
  return (
    <div className="signature-pad">
      <strong>Draw your signature</strong>
      <canvas
        aria-label="Signature pad"
        width={640}
        height={170}
        ref={ref}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const c = e.currentTarget.getContext('2d')!;
          c.lineWidth = 4;
          c.lineCap = 'round';
          c.strokeStyle = '#263044';
          const [x, y] = pos(e);
          c.beginPath();
          c.moveTo(x - 0.2, y);
          c.lineTo(x + 0.2, y);
          c.stroke();
          pen.current = true;
        }}
        onPointerMove={(e) => {
          if (pen.current) {
            const c = e.currentTarget.getContext('2d')!;
            c.lineTo(...pos(e));
            c.stroke();
          }
        }}
        onPointerUp={(e) => {
          pen.current = false;
          set(e.currentTarget.toDataURL('image/png'));
        }}
        onPointerCancel={() => {
          pen.current = false;
          set(ref.current!.toDataURL('image/png'));
        }}
      />
      <button
        type="button"
        className="text-btn"
        onClick={() => {
          ref.current!.getContext('2d')!.clearRect(0, 0, 640, 170);
          set('');
        }}
      >
        Clear signature
      </button>
    </div>
  );
}
export function Redactor({
  file,
  boxes,
  mark,
}: {
  file: File;
  boxes: Box[];
  mark: (r: Box[]) => void;
}) {
  const [pdf, open] = useState<PDFDocumentProxy | null>(null),
    [page, go] = useState(0),
    [url, show] = useState(''),
    [err, error] = useState(''),
    [draft, draw] = useState<Box | null>(null);
  const anchor = useRef<[number, number] | null>(null);
  useEffect(() => {
    let live = true,
      doc: PDFDocumentProxy | undefined;
    open(null);
    go(0);
    error('');
    void openPdf(file)
      .then((d) => {
        doc = d;
        if (live) open(d);
        else void d.destroy();
      })
      .catch((e) => {
        if (live) error(message(e));
      });
    return () => {
      live = false;
      void doc?.destroy();
    };
  }, [file]);
  useEffect(() => {
    let live = true;
    show('');
    if (pdf)
      void render(pdf, page, 900)
        .then(({ canvas }) => {
          if (live) show(canvas.toDataURL('image/jpeg', 0.8));
          canvas.width = 0;
        })
        .catch((e) => {
          if (live) error(message(e));
        });
    return () => {
      live = false;
    };
  }, [pdf, page]);
  const point = (e: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const b = e.currentTarget.getBoundingClientRect(),
      clamp = (v: number) => Math.max(0, Math.min(1, v));
    return [clamp((e.clientX - b.left) / b.width), clamp((e.clientY - b.top) / b.height)];
  };
  const rect = (a: [number, number], b: [number, number]) => ({
    page,
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.abs(a[0] - b[0]),
    h: Math.abs(a[1] - b[1]),
  });
  return (
    <div className="redactor">
      <p>
        Drag a rectangle over each area to erase. All pages are flattened into new images, without
        the underlying text, links or attachments.
      </p>
      <div className="line-actions">
        <button
          aria-label="Previous preview page"
          type="button"
          disabled={!page}
          onClick={() => go(page - 1)}
        >
          <ChevronLeft />
        </button>
        <small>
          Page {page + 1} / {pdf?.numPages || '…'}
        </small>
        <button
          aria-label="Next preview page"
          type="button"
          disabled={!pdf || page + 1 >= pdf.numPages}
          onClick={() => go(page + 1)}
        >
          <ChevronRight />
        </button>
        <button
          type="button"
          className="text-btn"
          disabled={!boxes.length}
          onClick={() => mark(boxes.slice(0, -1))}
        >
          <Undo2 size={15} />
          Undo area
        </button>
      </div>
      {url ? (
        <div
          className="redaction-page"
          aria-label="Mark redactions"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            anchor.current = point(e);
            draw(rect(anchor.current, anchor.current));
          }}
          onPointerMove={(e) => {
            if (anchor.current) draw(rect(anchor.current, point(e)));
          }}
          onPointerUp={(e) => {
            if (anchor.current) {
              const r = rect(anchor.current, point(e));
              if (r.w > 0.002 && r.h > 0.002) mark([...boxes, r]);
            }
            anchor.current = null;
            draw(null);
          }}
          onPointerCancel={() => {
            anchor.current = null;
            draw(null);
          }}
        >
          <img draggable={false} src={url} alt={`Preview of page ${page + 1}`} />
          {[...boxes, ...(draft ? [draft] : [])]
            .filter((b) => b.page === page)
            .map((b, i) => (
              <i
                key={i}
                style={{
                  left: b.x * 100 + '%',
                  top: b.y * 100 + '%',
                  width: b.w * 100 + '%',
                  height: b.h * 100 + '%',
                }}
              />
            ))}
        </div>
      ) : (
        !err && <Spin />
      )}
      <ErrorNote text={err} />
    </div>
  );
}
