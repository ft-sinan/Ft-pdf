/** All coordinates are fractions of the *uncropped* camera frame, clockwise from top left.
 * Only a small luminance frame is analysed. No model, network, camera roll or disk cache. */
export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export const fullFrame = (): Quad => [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const area = (p: Point[]) =>
  p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length];
    return sum + a.x * b.y - a.y * b.x;
  }, 0) / 2;
export function validQuad(q: Quad) {
  return (
    area(q) > 0.025 &&
    q.every(
      (p, i) =>
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1 &&
        cross(p, q[(i + 1) % 4], q[(i + 2) % 4]) > 0.007,
    )
  );
}

/** Unit square -> arbitrary convex quadrilateral (projective, not a bounding-box crop). */
export function project(q: Quad) {
  const [a, b, c, d] = q,
    dx = b.x - c.x,
    ex = d.x - c.x,
    dy = b.y - c.y,
    ey = d.y - c.y,
    sx = a.x - b.x + c.x - d.x,
    sy = a.y - b.y + c.y - d.y,
    den = dx * ey - ex * dy,
    g = (sx * ey - ex * sy) / den,
    h = (dx * sy - sx * dy) / den;
  return [
    b.x - a.x + g * b.x,
    d.x - a.x + h * d.x,
    a.x,
    b.y - a.y + g * b.y,
    d.y - a.y + h * d.y,
    a.y,
    g,
    h,
  ];
}
function outline(points: Point[]): Quad | null {
  // One left and one right boundary sample per row suffices for the convex hull.
  const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y);
  function chain(ps: Point[]) {
    const out: Point[] = [];
    for (const p of ps) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  }
  const hull = chain(sorted).concat(chain(sorted.reverse()));
  if (hull.length < 4) return null;
  const before = area(hull);
  while (hull.length > 4) {
    let min = Infinity,
      at = 0;
    for (let i = 0; i < hull.length; i++) {
      const loss = Math.abs(
        cross(hull[(i + hull.length - 1) % hull.length], hull[i], hull[(i + 1) % hull.length]),
      );
      if (loss < min) {
        min = loss;
        at = i;
      }
    }
    hull.splice(at, 1);
  }
  if (area(hull) < before * 0.89) return null; // Reject rounded objects, hands, etc.
  let start = 0;
  for (let i = 1; i < 4; i++) if (hull[i].x + hull[i].y < hull[start].x + hull[start].y) start = i;
  const q = hull.map((_, i) => hull[(i + start) % 4]) as Quad;
  return validQuad(q) ? q : null;
}
function signature(gray: Uint8Array, w: number, h: number, q: Quad) {
  const m = project(q),
    cols = 16,
    rows = 22,
    result = new Float32Array(cols * rows);
  let mean = 0;
  // Integrate small patches rather than sampling individual black/white pixels: a
  // one-pixel shift of printed lines must not look like a completely different page.
  const stride = w + 1,
    integral = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * stride + x + 1] = row + integral[y * stride + x + 1];
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      let value = 0;
      for (let s = 0; s < 3; s++)
        for (let t = 0; t < 3; t++) {
          const u = 0.05 + (0.9 * (i + (s + 0.5) / 3)) / cols,
            v = 0.05 + (0.9 * (j + (t + 0.5) / 3)) / rows,
            k = 1 / (m[6] * u + m[7] * v + 1),
            x = Math.round((m[0] * u + m[1] * v + m[2]) * k * (w - 1)),
            y = Math.round((m[3] * u + m[4] * v + m[5]) * k * (h - 1));
          const x0 = Math.max(0, x - 2),
            x1 = Math.min(w, x + 3),
            y0 = Math.max(0, y - 2),
            y1 = Math.min(h, y + 3);
          value +=
            (integral[y1 * stride + x1] -
              integral[y1 * stride + x0] -
              integral[y0 * stride + x1] +
              integral[y0 * stride + x0]) /
            ((x1 - x0) * (y1 - y0));
        }
      result[j * cols + i] = value / 9;
      mean += value / 9;
    }
  mean /= result.length;
  for (let i = 0; i < result.length; i++) result[i] -= mean;
  return result;
}
export type Sheet = { quad: Quad; sharp: boolean; print: Float32Array };
export function findSheet({
  data,
  width: w,
  height: h,
}: Pick<ImageData, 'data' | 'width' | 'height'>): Sheet | null {
  const n = w * h,
    gray = new Uint8Array(n),
    hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = 4 * i,
      v = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    gray[i] = v;
    hist[v]++;
    sum += v;
  }
  // Otsu threshold adapts to indoor light. Choose the largest enclosed, paper-shaped light region.
  let threshold = 0,
    best = 0,
    weight = 0,
    total = 0;
  for (let t = 0; t < 255; t++) {
    weight += hist[t];
    total += hist[t] * t;
    if (weight === 0 || weight === n) continue;
    const contrast = (sum - total) / (n - weight) - total / weight,
      score = weight * (n - weight) * contrast * contrast;
    if (score > best) {
      best = score;
      threshold = t;
    }
  }
  if (best < n * n * 22) return null;
  const seen = new Uint8Array(n),
    queue = new Int32Array(n);
  let chosen: Quad | null = null,
    largest = 0,
    focus = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i] || gray[i] <= threshold) continue;
    let head = 0,
      tail = 1,
      clipped = false;
    queue[0] = i;
    seen[i] = 1;
    const visit = (j: number) => {
      if (!seen[j] && gray[j] > threshold) {
        seen[j] = 1;
        queue[tail++] = j;
      }
    };
    while (head < tail) {
      const p = queue[head++],
        x = p % w;
      if (x < 2 || x > w - 3 || p < 2 * w || p >= n - 2 * w) clipped = true;
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p < n - w) visit(p + w);
    }
    if (clipped || tail < n * 0.115 || tail <= largest) continue;
    const left = new Int32Array(h).fill(w),
      right = new Int32Array(h).fill(-1);
    let lap = 0;
    for (let k = 0; k < tail; k++) {
      const p = queue[k],
        x = p % w,
        y = (p / w) | 0;
      left[y] = Math.min(x, left[y]);
      right[y] = Math.max(x, right[y]);
      const d = 4 * gray[p] - gray[p - 1] - gray[p + 1] - gray[p - w] - gray[p + w];
      lap += d * d;
    }
    const samples: Point[] = [];
    for (let y = 0; y < h; y++)
      if (right[y] >= 0) {
        samples.push(
          { x: left[y] / (w - 1), y: y / (h - 1) },
          { x: right[y] / (w - 1), y: y / (h - 1) },
        );
      }
    const q = outline(samples);
    if (!q || tail < area(q) * n * 0.51) continue;
    chosen = q;
    largest = tail;
    focus = lap / tail;
  }
  return chosen ? { quad: chosen, sharp: focus > 80, print: signature(gray, w, h, chosen) } : null;
}
function difference(a: Float32Array, b: Float32Array) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
  return Math.sqrt(d / a.length);
}
export class CaptureGate {
  private anchor: Sheet | null = null;
  private since = 0;
  private samples = 0;
  private last: Float32Array | null = null;
  reset() {
    this.anchor = null;
    this.samples = 0;
  }
  captured(s: Sheet | null) {
    this.last = s?.print || null;
    this.reset();
  }
  update(s: Sheet | null, now: number): 'find' | 'focus' | 'next' | 'steady' | 'capture' {
    if (!s || !s.sharp) {
      this.reset();
      return s ? 'focus' : 'find';
    }
    if (this.last && difference(this.last, s.print) < 15) {
      this.reset();
      return 'next';
    }
    if (
      !this.anchor ||
      s.quad.some(
        (p, i) => Math.hypot(p.x - this.anchor!.quad[i].x, p.y - this.anchor!.quad[i].y) > 0.023,
      ) ||
      difference(s.print, this.anchor.print) > 11
    ) {
      this.anchor = s;
      this.since = now;
      this.samples = 0;
    }
    return ++this.samples >= 4 && now - this.since >= 850 ? 'capture' : 'steady';
  }
}
