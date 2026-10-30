import type { Road, SideLine } from './road';
import type { Basemap } from './basemap';
import { pointAt } from './roadGeom';

export type NE = { north: number; east: number };
export type SectionKey = 'AX' | SideLine;
export interface SectionTarget extends NE { s: number; off: number; h: number | null; key: SectionKey }
export const SECTION_NAMES: Record<SectionKey, string> = { AX: 'Ось', KL: 'Левая кромка', KR: 'Правая кромка', BL: 'Левая бровка', BR: 'Правая бровка' };

export function segmentAt(r: Road, s: number) {
  if (!Number.isFinite(s) || r.pk.length < 2 || s < r.pk[0] || s > r.pk[r.pk.length - 1]) throw new Error('Пикет вне загруженной оси');
  let i = 0;
  while (i < r.pk.length - 2 && r.pk[i + 1] < s) i++;
  const span = r.pk[i + 1] - r.pk[i];
  const length = Math.hypot(r.n[i + 1] - r.n[i], r.e[i + 1] - r.e[i]);
  if (!(span > 0) || !(length > 0)) throw new Error('В оси есть вырожденный сегмент');
  return { i, t: (s - r.pk[i]) / span, tn: (r.n[i + 1] - r.n[i]) / length, te: (r.e[i + 1] - r.e[i]) / length };
}

export function sectionTargets(r: Road, s: number, layerDepth: number): SectionTarget[] {
  if (!Number.isFinite(layerDepth) || layerDepth < 0 || layerDepth > 10) throw new Error('Толщина слоёв должна быть от 0 до 10 м');
  const { i, t } = segmentAt(r, s);
  const at = (values: number[]) => {
    if (t <= 1e-9) return values[i];
    if (t >= 1 - 1e-9) return values[i + 1];
    return Number.isFinite(values[i]) && Number.isFinite(values[i + 1]) ? values[i] + t * (values[i + 1] - values[i]) : NaN;
  };
  return (['BL', 'KL', 'AX', 'KR', 'BR'] as SectionKey[]).flatMap((key) => {
    const line = key === 'AX' ? null : r.lines[key];
    if (key !== 'AX' && !line) return [];
    const off = line ? at(line.off) : 0;
    if (!Number.isFinite(off)) return [];
    const height = line ? at(line.h) : at(r.h);
    const p = pointAt(r, s, off);
    return [{ s, key, off, north: p.north, east: p.east, h: Number.isFinite(height) ? height - layerDepth : null }];
  });
}

/** Вектор относительно выбранного сечения, а не ближайшей ветви оси на повороте. */
export function sectionNavigation(r: Road, target: SectionTarget, here: NE & { height: number }) {
  const { tn, te } = segmentAt(r, target.s);
  const dn = target.north - here.north, de = target.east - here.east;
  return { along: dn * tn + de * te, right: -dn * te + de * tn, distance: Math.hypot(dn, de), dh: target.h == null ? null : target.h - here.height };
}

/** 1:m: насыпь понижается наружу, выемка повышается. Это контроль по текущей земле, не модель рельефа. */
export function slopeCheck(r: Road, anchor: SectionTarget, here: NE & { height: number }, m: number, fill: boolean) {
  if (!(m > 0) || !Number.isFinite(m) || anchor.h == null || anchor.off === 0) return null;
  const { tn, te } = segmentAt(r, anchor.s);
  const dn = here.north - anchor.north, de = here.east - anchor.east;
  const outward = (-dn * te + de * tn) * Math.sign(anchor.off);
  if (outward < 0) return null;
  const expected = anchor.h + (fill ? -1 : 1) * outward / m;
  return { outward, along: dn * tn + de * te, expected, dh: expected - here.height };
}

export function toleranceZone(distance: number, bands: number[]) {
  if (bands.length !== 3 || bands.some((n) => !Number.isFinite(n) || n <= 0) || !(bands[0] < bands[1] && bands[1] < bands[2])) throw new Error('Допуски должны возрастать: например 0.05; 0.5; 1');
  return distance <= bands[0] ? 0 : distance <= bands[1] ? 1 : distance <= bands[2] ? 2 : 3;
}

export type SnapMode = 'node' | 'mid' | 'intersection' | 'nearest';
export interface SnapPoint extends NE { line: number; segment: number }
type Seg = { a: NE; b: NE; line: number; segment: number };
export function snapDxf(bm: Basemap, here: NE, radius: number, mode: SnapMode): SnapPoint | null {
  let best: SnapPoint | null = null, limit = radius;
  const accept = (p: NE, line: number, segment: number) => { const d = Math.hypot(p.north - here.north, p.east - here.east); if (d <= limit) { limit = d; best = { ...p, line, segment }; } };
  const segments: Seg[] = [];
  bm.lines.forEach((l, line) => {
    if (!bm.layers[l.layer]?.visible) return;
    for (let j = 0; j + 3 < l.pts.length; j += 2) {
      const a = { east: l.pts[j], north: l.pts[j + 1] }, b = { east: l.pts[j + 2], north: l.pts[j + 3] };
      if (![a.east, a.north, b.east, b.north].every(Number.isFinite)) continue;
      const dn = b.north - a.north, de = b.east - a.east, sq = dn * dn + de * de;
      if (mode === 'node') { accept(a, line, j / 2); accept(b, line, j / 2); }
      if (mode === 'mid') accept({ north: (a.north + b.north) / 2, east: (a.east + b.east) / 2 }, line, j / 2);
      if (mode === 'nearest' && sq > 0) { const t = Math.max(0, Math.min(1, ((here.north - a.north) * dn + (here.east - a.east) * de) / sq)); accept({ north: a.north + t * dn, east: a.east + t * de }, line, j / 2); }
      if (mode === 'intersection' && Math.min(a.north, b.north) <= here.north + radius && Math.max(a.north, b.north) >= here.north - radius && Math.min(a.east, b.east) <= here.east + radius && Math.max(a.east, b.east) >= here.east - radius) segments.push({ a, b, line, segment: j / 2 });
    }
  });
  if (mode === 'intersection') {
    if (segments.length > 400) throw new Error('Слишком много линий рядом: приблизьте карту');
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      const un = a.b.north - a.a.north, ue = a.b.east - a.a.east, vn = b.b.north - b.a.north, ve = b.b.east - b.a.east;
      const det = un * ve - ue * vn;
      if (Math.abs(det) < 1e-10) continue;
      const wn = b.a.north - a.a.north, we = b.a.east - a.a.east;
      const t = (wn * ve - we * vn) / det, q = (wn * ue - we * un) / det;
      if (t >= 0 && t <= 1 && q >= 0 && q <= 1) accept({ north: a.a.north + t * un, east: a.a.east + t * ue }, a.line, a.segment);
    }
  }
  return best;
}
