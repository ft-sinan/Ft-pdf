import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ScanLine } from 'lucide-react';
import { CaptureGate, findSheet, fullFrame, type Quad, type Sheet } from '../tools/pageDetection';
import { snapshot } from '../tools/scanPages';
import { ErrorNote, Spin } from './UI';
import { message } from '../types';
import { rpc } from '../device/bridge';

const guide = {
  find: 'Fit all four edges of the paper in the frame.',
  focus: 'Focus on the paper, then hold still.',
  steady: 'Hold still…',
  capture: 'Capturing…',
  next: 'Page captured. Place the next sheet in view.',
};
export function Lines({ quad }: { quad: Quad }) {
  return (
    <svg className="scan-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon
        points={quad.map((p) => `${100 * p.x},${100 * p.y}`).join(' ')}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export default function LiveCamera({
  gate,
  accept,
}: {
  gate: CaptureGate;
  accept: (source: Blob, q: Quad) => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null),
    sheet = useRef<Sheet | null>(null),
    locked = useRef(false),
    life = useRef(0),
    onAccept = useRef(accept);
  onAccept.current = accept;
  const [quad, outline] = useState<Quad | null>(null),
    [hint, say] = useState(guide.find),
    [error, fail] = useState(''),
    [started, ready] = useState(false),
    [busy, work] = useState(false),
    [auto, setAuto] = useState(true),
    [retry, again] = useState(0);
  const automatic = useRef(auto);
  automatic.current = auto;
  const shot = useCallback(async () => {
    if (!video.current || locked.current) return;
    locked.current = true;
    work(true);
    fail('');
    const ticket = life.current,
      s = sheet.current;
    try {
      const photo = await snapshot(video.current);
      if (ticket !== life.current) return;
      await onAccept.current(photo, s?.quad || fullFrame());
      if (ticket === life.current) {
        gate.captured(s);
        say(guide.next);
      }
    } catch (e) {
      if (ticket === life.current) {
        fail(message(e));
        setAuto(false);
        gate.reset();
      }
    } finally {
      if (ticket === life.current) {
        locked.current = false;
        work(false);
      }
    }
  }, [gate]);
  useEffect(() => {
    const v = video.current!,
      c = document.createElement('canvas'),
      ctx = c.getContext('2d', { willReadFrequently: true })!;
    let stream: MediaStream | undefined,
      timer = 0,
      stopped = false,
      lastTime = -1;
    const stop = () => {
      stopped = true;
      life.current++;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      v.srcObject = null;
      gate.reset();
      sheet.current = null;
      locked.current = false;
      c.width = c.height = 0;
    };
    const pause = () => {
      if (stopped) return;
      stop();
      ready(false);
      work(false);
      outline(null);
      fail('Camera paused. Resume when you’re ready.');
    };
    const background = () => {
        if (stream) pause();
      },
      hidden = () => {
        if (document.hidden) background();
      };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('ft:camera-stop', background);
    window.addEventListener('pagehide', pause);
    ready(false);
    work(false);
    fail('');
    outline(null);
    say(guide.find);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error(
          'Live camera is unavailable. Update Android System WebView, or use Images to PDF.',
        );
      // Some Android WebViews omit all camera devices until the app has its runtime grant.
      if (!(await rpc<boolean>('camera.access')))
        throw new DOMException('Camera access is off.', 'NotAllowedError');
      if (stopped) return;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      });
      if (stopped || document.hidden) {
        stream.getTracks().forEach((t) => t.stop());
        if (!stopped) pause();
        return;
      }
      v.srcObject = stream;
      await v.play();
      if (stopped) return;
      ready(true);
      stream.getVideoTracks()[0]?.addEventListener('ended', pause, { once: true });
      timer = window.setInterval(() => {
        if (
          stopped ||
          locked.current ||
          !v.videoWidth ||
          v.readyState < 2 ||
          v.currentTime === lastTime
        )
          return;
        lastTime = v.currentTime;
        const r = 240 / Math.max(v.videoWidth, v.videoHeight),
          w = Math.max(1, Math.round(v.videoWidth * r)),
          h = Math.max(1, Math.round(v.videoHeight * r));
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
          gate.reset();
        }
        ctx.drawImage(v, 0, 0, w, h);
        const s = findSheet(ctx.getImageData(0, 0, w, h));
        sheet.current = s;
        outline(s?.quad || null);
        if (!automatic.current) {
          gate.reset();
          say('Manual mode · tap the shutter when ready.');
          return;
        }
        const state = gate.update(s, performance.now());
        say(guide[state]);
        if (state === 'capture') void shot();
      }, 160);
    })().catch((e) => {
      if (stopped) return;
      stop();
      ready(false);
      fail(
        e?.name === 'NotAllowedError'
          ? 'Camera access is off. Allow Camera in Android Settings → Apps → Ft PDF → Permissions, then try again. You can still use Images to PDF without camera access.'
          : e?.name === 'NotFoundError'
            ? 'No camera found. Use Images to PDF for photos already on this device.'
            : message(e),
      );
    });
    return () => {
      stop();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('ft:camera-stop', background);
      window.removeEventListener('pagehide', pause);
    };
  }, [gate, retry, shot]);
  return (
    <div className="scan-live">
      <div className="scan-view">
        <div className="scan-frame">
          <video muted playsInline ref={video} aria-label="Live camera preview" />
          {quad && <Lines quad={quad} />}
        </div>
        {!started && (
          <div className="scan-placeholder">{error ? <ScanLine size={30} /> : <Spin />}</div>
        )}
      </div>
      <p role="status" className="scan-hint">
        {started ? hint : error ? 'Camera unavailable' : 'Opening the rear camera…'}
      </p>
      <ErrorNote text={error} />
      {!started && error ? (
        <button className="btn secondary" onClick={() => again((n) => n + 1)}>
          Retry camera
        </button>
      ) : (
        <div className="scan-controls">
          <label className="tool-check">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                gate.reset();
                setAuto(e.target.checked);
              }}
            />
            Auto capture
          </label>
          <button
            className="btn primary"
            disabled={!started || busy}
            onClick={() => void shot()}
            aria-label="Capture page manually"
          >
            {busy ? <Spin /> : <Camera size={17} />}Capture page
          </button>
        </div>
      )}
    </div>
  );
}
