/**
 * COGO-расчёты на плоскости (грид-координаты N/E, метры).
 * Азимуты — от севера (оси N) по часовой стрелке, градусы.
 * Все функции чистые, покрыты тестами (см. cogo.test.md в корне).
 */

export interface NE {
  n: number;
  e: number;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** ПГЗ (прямая геодезическая задача): точка + азимут + расстояние → новая точка. */
export function forward(p: NE, azimuthDeg: number, distance: number): NE {
  const az = azimuthDeg * D2R;
  return {
    n: p.n + distance * Math.cos(az),
    e: p.e + distance * Math.sin(az),
  };
}

/** ОГЗ (обратная): две точки → расстояние и азимут (0–360). */
export function inverse(a: NE, b: NE): { distance: number; azimuthDeg: number } {
  const dN = b.n - a.n;
  const dE = b.e - a.e;
  const distance = Math.hypot(dN, dE);
  let az = Math.atan2(dE, dN) * R2D;
  if (az < 0) az += 360;
  return { distance, azimuthDeg: az };
}

/** Площадь полигона по формуле Гаусса (shoelace), м². Порядок обхода не важен. */
export function polygonArea(vertices: NE[]): number {
  if (vertices.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    s += a.e * b.n - b.e * a.n;
  }
  return Math.abs(s) / 2;
}

/** Периметр полигона (замкнутый контур), м. */
export function polygonPerimeter(vertices: NE[]): number {
  if (vertices.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    p += Math.hypot(b.n - a.n, b.e - a.e);
  }
  return p;
}

/** Длина полилинии (незамкнутой), м. */
export function polylineLength(vertices: NE[]): number {
  let p = 0;
  for (let i = 1; i < vertices.length; i++) {
    p += Math.hypot(vertices[i].n - vertices[i - 1].n, vertices[i].e - vertices[i - 1].e);
  }
  return p;
}

/** Градусы (десятичные) → ГМС. */
export function degToDms(deg: number): { d: number; m: number; s: number; neg: boolean } {
  const neg = deg < 0;
  let x = Math.abs(deg);
  const d = Math.floor(x);
  x = (x - d) * 60;
  const m = Math.floor(x);
  const s = (x - m) * 60;
  return { d, m, s, neg };
}

/** ГМС → десятичные градусы. */
export function dmsToDeg(d: number, m: number, s: number, neg = false): number {
  const v = Math.abs(d) + m / 60 + s / 3600;
  return neg ? -v : v;
}

/** Форматирует азимут как строку Г°М′С″. */
export function fmtDms(deg: number, secDigits = 1): string {
  const { d, m, s, neg } = degToDms(deg);
  const sign = neg ? '-' : '';
  return `${sign}${d}°${String(m).padStart(2, '0')}′${s.toFixed(secDigits).padStart(4, '0')}″`;
}

/** Среднее и СКО (стандартное отклонение по выборке, n-1). */
export function meanStd(values: number[]): { mean: number; std: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, std: 0 };
  const varSum = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  return { mean, std: Math.sqrt(varSum) };
}

/** Угол в точке B между направлениями B→A и B→C (0–180). */
export function angleAt(a: NE, b: NE, c: NE): number {
  const az1 = inverse(b, a).azimuthDeg;
  const az2 = inverse(b, c).azimuthDeg;
  let diff = Math.abs(az2 - az1);
  if (diff > 180) diff = 360 - diff;
  return diff;
}
