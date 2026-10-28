import { useEffect, useState } from 'react';
import { kvGet } from '../db/database';
import type { SurveyPoint } from '../db/types';
import { designAt, fmtPk, loadRoad, onRoadChange, stationOf, type Road, type Station } from './road';

/**
 * Контроль по трассе: пикет и смещение каждой точки, отклонение от проекта, толщина слоя
 * по съёмке «до», поперечные уклоны, полнота съёмки и объёмы «до/после».
 */

export interface RoadSettings {
  /** Допуск по высоте, мм (СП 78.13330: ±50 мм по оси). */
  tolH: number;
  /** Допуск по поперечному уклону, ‰ (СП 78.13330: ±10 ‰). */
  tolSlope: number;
  /** Точки ближе этого по пикету — один поперечник, м. */
  secTol: number;
  /** Шаг пикетов для контроля полноты, м. */
  pkStep: number;
}

export const DEFAULT_ROAD_SETTINGS: RoadSettings = { tolH: 50, tolSlope: 10, secTol: 3, pkStep: 20 };

export async function loadRoadSettings(): Promise<RoadSettings> {
  const [a, b, c, d] = await Promise.all(['tolH', 'tolSlope', 'secTol', 'pkStep'].map(kvGet));
  const num = (v: string | null, def: number) => { const x = parseFloat(v ?? ''); return Number.isFinite(x) && x > 0 ? x : def; };
  return {
    tolH: num(a, DEFAULT_ROAD_SETTINGS.tolH), tolSlope: num(b, DEFAULT_ROAD_SETTINGS.tolSlope),
    secTol: num(c, DEFAULT_ROAD_SETTINGS.secTol), pkStep: num(d, DEFAULT_ROAD_SETTINGS.pkStep),
  };
}

export function useRoad(pid: string | undefined) {
  const [road, setRoad] = useState<Road | null>(null);
  useEffect(() => {
    if (!pid) { setRoad(null); return; }
    let alive = true;
    loadRoad(pid).then((r) => alive && setRoad(r));
    const off = onRoadChange((changed) => { if (changed === pid) loadRoad(pid).then((r) => alive && setRoad(r)); });
    return () => { alive = false; off(); };
  }, [pid]);
  return road;
}

export interface Row {
  p: SurveyPoint;
  st: Station | null;
  /** Проектная отметка, м. */
  hd: number | null;
  /** Факт − проект, мм. */
  dh: number | null;
  ok: boolean | null;
  /** Толщина над съёмкой «до», мм. */
  thick: number | null;
}

export const isBefore = (p: SurveyPoint) => (p.stage ?? '') === 'до';

/** Пикет, смещение и отклонение для всех точек с местными координатами; по пикету. */
export function analyse(road: Road, points: SurveyPoint[], set: RoadSettings): Row[] {
  const rows: Row[] = points.map((p) => {
    if (p.north == null || p.east == null) return { p, st: null, hd: null, dh: null, ok: null, thick: null };
    const st = stationOf(road, p.north, p.east);
    const hd = designAt(road, st);
    const dh = hd != null && p.height != null ? (p.height - hd) * 1000 : null;
    return { p, st, hd, dh, ok: dh != null ? Math.abs(dh) <= set.tolH : null, thick: null };
  });
  const before = rows.filter((r) => r.st && isBefore(r.p));
  if (before.length) {
    for (const r of rows) {
      if (!r.st || isBefore(r.p) || r.p.height == null) continue;
      const hb = surfaceAt(before, r.st.s, r.st.off, set.secTol);
      if (hb != null) r.thick = (r.p.height - hb) * 1000;
    }
  }
  return rows.sort((a, b) => (a.st?.s ?? Infinity) - (b.st?.s ?? Infinity));
}

/** Отметка поверхности «до» в точке: по точкам того же поперечника, линейно по смещению. */
function surfaceAt(before: Row[], s: number, off: number, secTol: number): number | null {
  const near = before.filter((r) => Math.abs(r.st!.s - s) <= Math.max(secTol, 1))
    .sort((a, b) => Math.abs(a.st!.s - s) - Math.abs(b.st!.s - s));
  // на одном смещении — ближайшая по пикету, чтобы соседние поперечники не смешивались
  const prof: Array<[number, number]> = [];
  for (const r of near) {
    if (!prof.some(([o]) => Math.abs(o - r.st!.off) < 0.3)) prof.push([r.st!.off, r.p.height!]);
  }
  return profileValue(prof, off, 1);
}

/** Линейная интерполяция по точкам профиля (смещение, отметка); вне диапазона — ближняя в пределах reach. */
function profileValue(pts: Array<[number, number]>, o: number, reach: number): number | null {
  if (!pts.length) return null;
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  if (o <= p[0][0]) return p[0][0] - o <= reach ? p[0][1] : null;
  if (o >= p[p.length - 1][0]) return o - p[p.length - 1][0] <= reach ? p[p.length - 1][1] : null;
  for (let j = 0; j < p.length - 1; j++) {
    const [o1, h1] = p[j]; const [o2, h2] = p[j + 1];
    if (o <= o2) return o2 === o1 ? h1 : h1 + ((o - o1) / (o2 - o1)) * (h2 - h1);
  }
  return null;
}

// ---------- поперечники ----------

export interface Section { s: number; rows: Row[] }

/** Точки одного поперечника: соседние по пикету ближе secTol. */
export function sections(rows: Row[], secTol: number): Section[] {
  const out: Section[] = [];
  let cur: Row[] = [];
  for (const r of rows.filter((x) => x.st && !x.st.outside)) {
    if (cur.length && r.st!.s - cur[0].st!.s > secTol) { out.push(mk(cur)); cur = []; }
    cur.push(r);
  }
  if (cur.length) out.push(mk(cur));
  return out;
  function mk(rs: Row[]): Section { return { s: rs.reduce((a, r) => a + r.st!.s, 0) / rs.length, rows: rs }; }
}

export interface Slope {
  s: number;
  left: SlopeSide | null;
  right: SlopeSide | null;
}
export interface SlopeSide { fact: number; design: number | null; ok: boolean | null; from: string; to: string }

/**
 * Поперечные уклоны поперечника по точкам «левая, середина, правая» (по умолчанию OBL, DOR, OBP):
 * ‰ от середины наружу, минус — вниз от оси. Проект — по проектным отметкам в тех же точках.
 */
export function slopes(secs: Section[], seq: string[], tolSlope: number): Slope[] {
  if (seq.length < 3) return [];
  const [L, C, R] = seq;
  const pick = (sec: Section, code: string) => sec.rows.filter((r) => r.p.code === code && !isBefore(r.p) && r.p.height != null).pop();
  const side = (c: Row, o: Row): SlopeSide | null => {
    const w = Math.abs(o.st!.off - c.st!.off);
    if (w < 0.3) return null;
    const fact = ((o.p.height! - c.p.height!) / w) * 1000;
    const design = o.hd != null && c.hd != null ? ((o.hd - c.hd) / w) * 1000 : null;
    return { fact, design, ok: design != null ? Math.abs(fact - design) <= tolSlope : null, from: c.p.name, to: o.p.name };
  };
  const out: Slope[] = [];
  for (const sec of secs) {
    const c = pick(sec, C);
    if (!c) continue;
    const l = pick(sec, L); const r = pick(sec, R);
    const sl = { s: sec.s, left: l ? side(c, l) : null, right: r ? side(c, r) : null };
    if (sl.left || sl.right) out.push(sl);
  }
  return out;
}

/** Уклоны поперечника, где лежит только что снятая точка — для голоса после замыкания поперечника. */
export function slopeAfterShot(rows: Row[], name: string, seq: string[], set: RoadSettings): Slope | null {
  const me = rows.find((r) => r.p.name === name);
  if (!me?.st) return null;
  const sec = rows.filter((r) => r.st && !isBefore(r.p) && Math.abs(r.st.s - me.st!.s) <= set.secTol);
  return slopes([{ s: me.st.s, rows: sec }], seq, set.tolSlope)[0] ?? null;
}

// ---------- полнота ----------

export interface Coverage { stations: number[]; codes: string[]; have: boolean[][]; missing: number }

/** Таблица «пикет × объект»: есть ли точка объекта ближе secTol к круглому пикету. */
export function coverage(rows: Row[], codes: string[], set: RoadSettings, from?: number, to?: number): Coverage {
  const ok = rows.filter((r) => r.st && !r.st.outside && !isBefore(r.p));
  if (!ok.length) return { stations: [], codes, have: [], missing: 0 };
  const lo = from ?? Math.floor(Math.min(...ok.map((r) => r.st!.s)) / set.pkStep) * set.pkStep;
  const hi = to ?? Math.ceil(Math.max(...ok.map((r) => r.st!.s)) / set.pkStep) * set.pkStep;
  const stations: number[] = [];
  for (let s = lo; s <= hi + 1e-6 && stations.length < 5000; s += set.pkStep) stations.push(Math.round(s * 100) / 100);
  let missing = 0;
  const have = stations.map((s) => codes.map((c) => {
    const hit = ok.some((r) => r.p.code === c && Math.abs(r.st!.s - s) <= set.secTol);
    if (!hit) missing++;
    return hit;
  }));
  return { stations, codes, have, missing };
}

// ---------- объёмы «до / после» ----------

export interface VolRow {
  s: number;
  /** Площади на поперечнике, м²: отсыпка (+) и срезка (−) слева и справа от оси. */
  fillL: number; cutL: number; fillR: number; cutR: number;
  /** Объём от предыдущего поперечника, м³. */
  vFill: number; vCut: number;
}

/** Площадь между профилями «после» и «до» на общем отрезке смещений: [отсыпка, срезка]. */
function areaBetween(after: Array<[number, number]>, before: Array<[number, number]>): [number, number] {
  if (after.length < 2 || before.length < 2) return [0, 0];
  const a = [...after].sort((x, y) => x[0] - y[0]); const b = [...before].sort((x, y) => x[0] - y[0]);
  const lo = Math.max(a[0][0], b[0][0]); const hi = Math.min(a[a.length - 1][0], b[b.length - 1][0]);
  if (hi - lo < 0.05) return [0, 0];
  const xs = [...new Set([lo, hi, ...a.map((p) => p[0]), ...b.map((p) => p[0])].filter((x) => x >= lo && x <= hi))].sort((x, y) => x - y);
  let fill = 0; let cut = 0;
  for (let k = 0; k < xs.length - 1; k++) {
    const x1 = xs[k]; const x2 = xs[k + 1];
    const d1 = profileValue(a, x1, 0)! - profileValue(b, x1, 0)!;
    const d2 = profileValue(a, x2, 0)! - profileValue(b, x2, 0)!;
    const w = x2 - x1;
    if (d1 >= 0 && d2 >= 0) fill += ((d1 + d2) / 2) * w;
    else if (d1 <= 0 && d2 <= 0) cut -= ((d1 + d2) / 2) * w;
    else { // смена знака внутри — делим треугольниками
      const x0 = (Math.abs(d1) / (Math.abs(d1) + Math.abs(d2))) * w;
      const t1 = (Math.abs(d1) * x0) / 2; const t2 = (Math.abs(d2) * (w - x0)) / 2;
      if (d1 > 0) { fill += t1; cut += t2; } else { cut += t1; fill += t2; }
    }
  }
  return [fill, cut];
}

/**
 * Объёмы по съёмкам «до» и «после» выбранных объектов (кюветы, обочины): площади на поперечниках «после»,
 * объём — по средним площадям между соседними поперечниками (не дальше maxGap). На стороне нужно ≥ 2 точек
 * в обеих съёмках, иначе площадь не считается.
 */
export function volumes(rows: Row[], codes: string[], set: RoadSettings, maxGap = 50): { rows: VolRow[]; fill: number; cut: number } {
  const use = rows.filter((r) => r.st && !r.st.outside && r.p.height != null && codes.includes(r.p.code));
  const after = use.filter((r) => !isBefore(r.p));
  const before = use.filter((r) => isBefore(r.p));
  const win = Math.max(set.secTol, 5);
  const out: VolRow[] = [];
  for (const sec of sections(after, set.secTol)) {
    const bs = before.filter((r) => Math.abs(r.st!.s - sec.s) <= win);
    if (!bs.length) continue;
    const prof = (rs: Row[], left: boolean) => rs.filter((r) => (left ? r.st!.off < 0 : r.st!.off >= 0)).map((r) => [r.st!.off, r.p.height!] as [number, number]);
    const [fillL, cutL] = areaBetween(prof(sec.rows, true), prof(bs, true));
    const [fillR, cutR] = areaBetween(prof(sec.rows, false), prof(bs, false));
    if (!(fillL || cutL || fillR || cutR)) continue;
    const prev = out[out.length - 1];
    let vFill = 0; let vCut = 0;
    if (prev && sec.s - prev.s <= maxGap) {
      const L = sec.s - prev.s;
      vFill = ((prev.fillL + prev.fillR + fillL + fillR) / 2) * L;
      vCut = ((prev.cutL + prev.cutR + cutL + cutR) / 2) * L;
    }
    out.push({ s: sec.s, fillL, cutL, fillR, cutR, vFill, vCut });
  }
  return { rows: out, fill: out.reduce((a, r) => a + r.vFill, 0), cut: out.reduce((a, r) => a + r.vCut, 0) };
}

/** Короткая сводка для голоса и строки под кнопками: «ПК 12+34.5, вправо 3.40, +12 мм». */
export function rowSummary(r: Row): string {
  if (!r.st) return 'нет калибровки — пикет не посчитан';
  const parts = [`ПК ${fmtPk(r.st.s, 1)}`, `${r.st.off >= 0 ? '→' : '←'} ${Math.abs(r.st.off).toFixed(2)}`];
  if (r.st.outside) parts.push('за концом оси');
  if (r.dh != null) parts.push(`Δ ${r.dh >= 0 ? '+' : ''}${r.dh.toFixed(0)} мм${r.ok ? '' : ' ✗'}`);
  if (r.thick != null) parts.push(`толщ. ${r.thick.toFixed(0)} мм`);
  return parts.join(' · ');
}
