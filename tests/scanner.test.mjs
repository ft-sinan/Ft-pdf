import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CaptureGate,
  findSheet,
  validQuad,
  fullFrame,
  project,
} from '../src/tools/pageDetection.ts';
function scene(second = false, dx = 0, blur = 0) {
  const width = 180,
    height = 164,
    data = new Uint8ClampedArray(4 * width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const l = 25 + dx + y * 0.08,
        r = 151 + dx - y * 0.03,
        t = 17 + x * 0.04,
        b = 148 - x * 0.02;
      const distance = Math.min(x - l, r - x, y - t, b - y);
      let v = blur
        ? 35 + 200 * Math.max(0, Math.min(1, 0.5 + distance / blur))
        : distance > 0
          ? 235
          : 35;
      if (distance > 17 && !blur && y % 18 < 3 && (!second || x > 94)) v = 55;
      if (second && x > 52 && x < 85 && y > 35 && y < 100) v = 75;
      const i = 4 * (y * width + x);
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { width, height, data };
}
test('page outline follows a skewed sheet, not the frame; focus and steadiness gate capture', () => {
  const s = findSheet(scene());
  assert.ok(s?.sharp);
  const [a, b, c, d] = s.quad;
  assert.ok(a.x > 0.12 && a.x < 0.19 && a.y < 0.14 && b.y > a.y && d.x > a.x && c.x < b.x);
  assert.equal(findSheet(scene(false, 0, 25))?.sharp, false);
  const g = new CaptureGate();
  assert.equal(g.update(null, 0), 'find');
  assert.equal(g.update({ ...s, sharp: false }, 4), 'focus');
  let state;
  for (let t = 0; t <= 1000; t += 200) state = g.update(s, t);
  assert.equal(state, 'capture');
  g.captured(s);
  assert.equal(g.update(null, 1500), 'find');
  assert.equal(g.update(findSheet(scene(false, 3)), 2200), 'next');
  const changed = findSheet(scene(true));
  for (let t = 2400; t <= 3400; t += 200) state = g.update(changed, t);
  assert.equal(state, 'capture');
  const g2 = new CaptureGate();
  for (let t = 0; t < 2000; t += 200)
    assert.notEqual(g2.update(findSheet(scene(false, t % 400 ? 0 : 7)), t), 'capture');
});
test('perspective transform takes all four crop corners to the corresponding source pixels', () => {
  const q = findSheet(scene()).quad,
    m = project(q);
  fullFrame().forEach(({ x, y }, i) => {
    const z = m[6] * x + m[7] * y + 1;
    assert.ok(Math.abs((m[0] * x + m[1] * y + m[2]) / z - q[i].x) < 1e-7);
    assert.ok(Math.abs((m[3] * x + m[4] * y + m[5]) / z - q[i].y) < 1e-7);
  });
  assert.equal(validQuad([q[0], q[2], q[1], q[3]]), false);
});
