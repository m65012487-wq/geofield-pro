/**
 * TIN: триангуляция Делоне (Bowyer–Watson) по местным N/E, интерполяция высоты и объём между двумя поверхностями
 * суммированием по регулярной сетке. Координаты: x = East, y = North, z = высота.
 */

export interface TinPoint { x: number; y: number; z: number }

export interface Tin {
  /** Точки (после удаления дублей), сдвинутые на (ox, oy) для устойчивости вычислений. */
  pts: TinPoint[];
  /** Треугольники: тройки индексов в pts. */
  tris: Array<[number, number, number]>;
  ox: number;
  oy: number;
}

/** Максимум точек: триангуляция O(n²). */
export const TIN_MAX_POINTS = 3000;

/**
 * Строит TIN. maxEdge — треугольники с ребром длиннее (в плане) отбрасываются, чтобы не было ложной
 * выпуклой оболочки над пустотой. Точки с совпадающими N/E (до 1 мм) схлопываются в первую.
 */
export function buildTin(input: TinPoint[], maxEdge = Infinity): Tin {
  const seen = new Set<string>();
  const src: TinPoint[] = [];
  for (const p of input) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    const k = `${Math.round(p.x * 1000)}_${Math.round(p.y * 1000)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    src.push(p);
  }
  if (src.length > TIN_MAX_POINTS) throw new Error(`Слишком много точек (${src.length}), максимум ${TIN_MAX_POINTS}`);
  const n = src.length;
  if (n < 3) return { pts: [], tris: [], ox: 0, oy: 0 };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of src) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
  const pts: TinPoint[] = src.map((p) => ({ x: p.x - ox, y: p.y - oy, z: p.z }));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const R = span * 20;
  // три вершины супертреугольника — индексы n, n+1, n+2
  const all: TinPoint[] = [...pts, { x: -R, y: -R, z: 0 }, { x: R, y: -R, z: 0 }, { x: 0, y: R, z: 0 }];

  interface T { a: number; b: number; c: number; cx: number; cy: number; r2: number }
  const mk = (a: number, b: number, c: number): T | null => {
    const A = all[a], B = all[b], C = all[c];
    const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    if (Math.abs(d) < 1e-12) return null; // вырожденный (коллинеарный)
    const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y;
    const cx = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d;
    const cy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
    return { a, b, c, cx, cy, r2: (A.x - cx) ** 2 + (A.y - cy) ** 2 };
  };

  let tris: T[] = [mk(n, n + 1, n + 2)!];
  for (let i = 0; i < n; i++) {
    const p = all[i];
    const bad: T[] = [];
    const keep: T[] = [];
    for (const t of tris) {
      const d2 = (p.x - t.cx) ** 2 + (p.y - t.cy) ** 2;
      (d2 < t.r2 * (1 - 1e-12) ? bad : keep).push(t);
    }
    // граница полости: рёбра, встретившиеся один раз
    const edges = new Map<string, [number, number, number]>();
    const add = (u: number, v: number) => {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      const e = edges.get(k);
      if (e) e[2]++; else edges.set(k, [u, v, 1]);
    };
    for (const t of bad) { add(t.a, t.b); add(t.b, t.c); add(t.c, t.a); }
    for (const [u, v, cnt] of edges.values()) {
      if (cnt !== 1) continue;
      const t = mk(u, v, i);
      if (t) keep.push(t);
    }
    tris = keep;
  }

  const L2 = maxEdge * maxEdge;
  const e2 = (P: TinPoint, Q: TinPoint) => (P.x - Q.x) ** 2 + (P.y - Q.y) ** 2;
  const out: Array<[number, number, number]> = [];
  for (const t of tris) {
    if (t.a >= n || t.b >= n || t.c >= n) continue;
    const A = pts[t.a], B = pts[t.b], C = pts[t.c];
    if (e2(A, B) > L2 || e2(B, C) > L2 || e2(C, A) > L2) continue;
    out.push([t.a, t.b, t.c]);
  }
  return { pts, tris: out, ox, oy };
}

const EPS = -1e-9;
function baryZ(A: TinPoint, B: TinPoint, C: TinPoint, px: number, py: number): number | null {
  const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
  if (Math.abs(d) < 1e-14) return null;
  const l1 = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / d;
  const l2 = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / d;
  const l3 = 1 - l1 - l2;
  if (l1 < EPS || l2 < EPS || l3 < EPS) return null;
  return l1 * A.z + l2 * B.z + l3 * C.z;
}

/** Высота в точке (x, y) по TIN; null — вне треугольников. Линейный перебор: для единичных запросов. */
export function interpolate(tin: Tin, x: number, y: number): number | null {
  const px = x - tin.ox, py = y - tin.oy;
  for (const [a, b, c] of tin.tris) {
    const z = baryZ(tin.pts[a], tin.pts[b], tin.pts[c], px, py);
    if (z != null) return z;
  }
  return null;
}

export interface Grid { x0: number; y0: number; step: number; nx: number; ny: number }

/** Высоты поверхности в центрах ячеек сетки (NaN — узел вне треугольников). Растеризация по треугольникам. */
export function sampleGrid(tin: Tin, g: Grid): Float64Array {
  const z = new Float64Array(g.nx * g.ny).fill(NaN);
  for (const [a, b, c] of tin.tris) {
    const A = tin.pts[a], B = tin.pts[b], C = tin.pts[c];
    const minX = Math.min(A.x, B.x, C.x) + tin.ox, maxX = Math.max(A.x, B.x, C.x) + tin.ox;
    const minY = Math.min(A.y, B.y, C.y) + tin.oy, maxY = Math.max(A.y, B.y, C.y) + tin.oy;
    const i0 = Math.max(0, Math.ceil((minX - g.x0) / g.step - 0.5));
    const i1 = Math.min(g.nx - 1, Math.floor((maxX - g.x0) / g.step - 0.5));
    const j0 = Math.max(0, Math.ceil((minY - g.y0) / g.step - 0.5));
    const j1 = Math.min(g.ny - 1, Math.floor((maxY - g.y0) / g.step - 0.5));
    for (let j = j0; j <= j1; j++) {
      const py = g.y0 + (j + 0.5) * g.step - tin.oy;
      for (let i = i0; i <= i1; i++) {
        const px = g.x0 + (i + 0.5) * g.step - tin.ox;
        const h = baryZ(A, B, C, px, py);
        if (h != null) z[j * g.nx + i] = h;
      }
    }
  }
  return z;
}

export interface VolumeResult {
  /** Объём, где верхняя поверхность выше основания (отсыпка), м³. */
  fill: number;
  /** Объём, где ниже (срезка), м³. */
  cut: number;
  /** Площадь общей области, м². */
  area: number;
  step: number;
  nodes: number;
}

/** Ограничивающий прямоугольник TIN в исходных координатах. */
export function tinBounds(t: Tin) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [a, b, c] of t.tris) {
    for (const i of [a, b, c]) {
      const p = t.pts[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX: minX + t.ox, maxX: maxX + t.ox, minY: minY + t.oy, maxY: maxY + t.oy };
}

/** Шаг сетки: не мельче minStep и так, чтобы узлов было не больше maxNodes; округляется вверх до «круглого». */
export function pickStep(w: number, h: number, maxNodes = 200000, minStep = 0.05): number {
  const step = Math.max(minStep, Math.sqrt((w * h) / maxNodes));
  const nice = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
  return nice.find((v) => v >= step) ?? step;
}

/**
 * Объём между верхней поверхностью и основанием. base — TIN «съёмки ДО» или число (плоскость H = …).
 * Учитываются узлы сетки, попавшие внутрь треугольников обеих поверхностей.
 */
export function volumeBetween(top: Tin, base: Tin | number, maxNodes = 200000): VolumeResult {
  let { minX, maxX, minY, maxY } = tinBounds(top);
  if (typeof base !== 'number') {
    const c = tinBounds(base);
    minX = Math.max(minX, c.minX); maxX = Math.min(maxX, c.maxX);
    minY = Math.max(minY, c.minY); maxY = Math.min(maxY, c.maxY);
  }
  if (!(maxX > minX && maxY > minY)) return { fill: 0, cut: 0, area: 0, step: 0, nodes: 0 };
  const step = pickStep(maxX - minX, maxY - minY, maxNodes);
  const g: Grid = {
    x0: minX, y0: minY, step,
    nx: Math.max(1, Math.ceil((maxX - minX) / step)), ny: Math.max(1, Math.ceil((maxY - minY) / step)),
  };
  const zt = sampleGrid(top, g);
  const zb = typeof base === 'number' ? null : sampleGrid(base, g);
  let fill = 0, cut = 0, nodes = 0;
  const cell = step * step;
  for (let k = 0; k < zt.length; k++) {
    const t = zt[k];
    if (Number.isNaN(t)) continue;
    const bb = zb ? zb[k] : (base as number);
    if (Number.isNaN(bb)) continue;
    const d = t - bb;
    nodes++;
    if (d > 0) fill += d * cell; else cut -= d * cell;
  }
  return { fill, cut, area: nodes * cell, step, nodes };
}
