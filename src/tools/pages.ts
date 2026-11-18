/** One-based UI ranges, translated to zero-based indices; preserve intentional ordering. */
export function pageRange(spec: string, count: number, all = true) {
  if (!Number.isInteger(count) || count < 1 || count > 1500)
    throw Error('Use a PDF with 1–1,500 pages.');
  if (!spec.trim()) {
    if (!all) throw Error('Enter at least one page number.');
    return Array.from({ length: count }, (_, i) => i);
  }
  const out: number[] = [],
    seen = new Set<number>();
  for (const token of spec.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(token);
    if (!m) throw Error('Use page numbers and ranges, like 1, 3-5.');
    const a = Number(m[1]),
      b = Number(m[2] || m[1]);
    if (a < 1 || b < a || b > count) throw Error(`Page range must be between 1 and ${count}.`);
    for (let i = a - 1; i < b; i++)
      if (!seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
  }
  return out;
}
export type Box = { page: number; x: number; y: number; w: number; h: number };
