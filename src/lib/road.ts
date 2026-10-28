import { File, Paths } from 'expo-file-system';

/**
 * Трасса проекта: ось с пикетажем и проектными отметками, плюс (если загружены) кромки и бровки.
 * Формат txt — как выгрузки проекта по Чегем II–Булунгу: «ПК+расст,N,E,H» (0+00.00,498269.318,237925.505,1035.832).
 * Кромки и бровки приводятся к станциям оси: для каждой станции — смещение (вправо +) и отметка.
 */
export type SideLine = 'KL' | 'KR' | 'BL' | 'BR';
export const SIDE_TITLE: Record<SideLine, string> = {
  KL: 'Левая кромка', KR: 'Правая кромка', BL: 'Левая бровка', BR: 'Правая бровка',
};

export interface Road {
  name: string;
  pk: number[]; n: number[]; e: number[]; h: number[];
  /** По станциям оси: смещение и проектная отметка линии (NaN — линия здесь не задана). */
  lines: Partial<Record<SideLine, { off: number[]; h: number[] }>>;
}

export interface Station {
  /** Пикетаж, м от ПК 0. */
  s: number;
  /** Смещение от оси, м: вправо по ходу пикетажа +, влево −. */
  off: number;
  /** Точка за началом или концом оси. */
  outside: boolean;
  /** Номер сегмента оси (для отметок). */
  i: number;
  t: number;
}

/** «12+34.50» → 1234.5; просто число — как есть. */
export function parsePk(s: string): number | null {
  const m = s.trim().match(/^(?:ПК|PK)?\s*(-?\d+)\s*\+\s*(\d+(?:[.,]\d+)?)$/i);
  if (m) return parseInt(m[1], 10) * 100 + parseFloat(m[2].replace(',', '.'));
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) && /^-?\d+([.,]\d+)?$/.test(s.trim()) ? v : null;
}

/** 1234.5 → «12+34.50». */
export function fmtPk(s: number, digits = 2) {
  const neg = s < 0;
  const a = Math.abs(s);
  let hund = Math.floor(a / 100);
  let rest = a - hund * 100;
  if (Number(rest.toFixed(digits)) >= 100) { hund += 1; rest = 0; }
  return `${neg ? '-' : ''}${hund}+${rest.toFixed(digits).padStart(digits ? digits + 3 : 2, '0')}`;
}

export function fmtOff(o: number) {
  return `${o >= 0 ? 'вправо' : 'влево'} ${Math.abs(o).toFixed(2)}`;
}

/** Строки «ПК или имя, N, E, H». Без пикетажа в файле — считается по длине от первой точки. */
export function parseLineTxt(text: string): { pk: number[]; n: number[]; e: number[]; h: number[] } {
  const pk: number[] = []; const n: number[] = []; const e: number[] = []; const h: number[] = [];
  let havePk = true;
  for (const raw of text.split(/\r?\n/)) {
    const f = raw.split(/[;,\t]|\s+/).map((x) => x.trim()).filter(Boolean);
    if (f.length < 4) continue;
    const N = parseFloat(f[1].replace(',', '.')); const E = parseFloat(f[2].replace(',', '.'));
    const H = parseFloat(f[3].replace(',', '.'));
    if (![N, E, H].every(Number.isFinite)) continue;
    const p = parsePk(f[0]);
    if (p == null || !f[0].includes('+')) havePk = false;
    pk.push(p ?? NaN); n.push(N); e.push(E); h.push(H);
  }
  if (n.length < 2) throw new Error('В файле меньше двух точек «ПК,N,E,H»');
  if (!havePk) {
    pk[0] = 0;
    for (let i = 1; i < n.length; i++) pk[i] = pk[i - 1] + Math.hypot(n[i] - n[i - 1], e[i] - e[i - 1]);
  }
  return { pk, n, e, h };
}

/** Проекция точки на ось: ближайший сегмент. */
export function stationOf(r: Road, N: number, E: number): Station {
  let best = { d: Infinity, i: 0, t: 0, off: 0 };
  for (let i = 0; i < r.n.length - 1; i++) {
    const dN = r.n[i + 1] - r.n[i]; const dE = r.e[i + 1] - r.e[i];
    const L2 = dN * dN + dE * dE;
    if (!L2) continue;
    const vN = N - r.n[i]; const vE = E - r.e[i];
    const t = Math.max(0, Math.min(1, (vN * dN + vE * dE) / L2));
    const pN = r.n[i] + t * dN; const pE = r.e[i] + t * dE;
    const d = Math.hypot(N - pN, E - pE);
    if (d < best.d) best = { d, i, t, off: (dN * vE - dE * vN) / Math.sqrt(L2) };
  }
  const last = r.n.length - 2;
  // за концами оси проекция упирается в крайнюю точку — пикет продлеваем по направлению сегмента
  const { i } = best;
  const dN = r.n[i + 1] - r.n[i]; const dE = r.e[i + 1] - r.e[i]; const L = Math.hypot(dN, dE) || 1;
  const along = ((N - r.n[i]) * dN + (E - r.e[i]) * dE) / L;
  const ds = r.pk[i + 1] - r.pk[i];
  let s = r.pk[i] + best.t * ds;
  let outside = false;
  if ((i === 0 && along < 0) || (i === last && along > L)) {
    outside = true;
    s = r.pk[i] + (along / L) * ds;
  }
  return { s, off: best.off, outside, i, t: best.t };
}

/** Поперечный профиль проекта на станции k: точки (смещение, отметка), по возрастанию смещения. */
function profileAt(r: Road, k: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [[0, r.h[k]]];
  for (const key of ['BL', 'KL', 'KR', 'BR'] as SideLine[]) {
    const l = r.lines[key];
    if (l && Number.isFinite(l.off[k]) && Number.isFinite(l.h[k])) pts.push([l.off[k], l.h[k]]);
  }
  return pts.sort((a, b) => a[0] - b[0]);
}

const EDGE_REACH = 0.3; // за крайней проектной линией ещё столько метров считаем по ней

function interpProfile(p: Array<[number, number]>, o: number): number | null {
  if (p.length === 1) return Math.abs(o) <= 0.5 ? p[0][1] : null; // только ось — без поперечника
  if (o < p[0][0] - EDGE_REACH || o > p[p.length - 1][0] + EDGE_REACH) return null;
  if (o <= p[0][0]) return p[0][1];
  for (let j = 0; j < p.length - 1; j++) {
    const [o1, h1] = p[j]; const [o2, h2] = p[j + 1];
    if (o <= o2) return o2 === o1 ? h1 : h1 + ((o - o1) / (o2 - o1)) * (h2 - h1);
  }
  return p[p.length - 1][1];
}

/** Проектная отметка в точке (пикет, смещение) — по ближайшим станциям; null — вне проекта. */
export function designAt(r: Road, st: Station): number | null {
  if (st.outside) return null;
  const a = interpProfile(profileAt(r, st.i), st.off);
  const b = interpProfile(profileAt(r, st.i + 1), st.off);
  if (a == null || b == null) return a ?? b;
  return a + st.t * (b - a);
}

/** Привести линию (кромку/бровку) к станциям оси. */
function attachLine(r: Road, src: { n: number[]; e: number[]; h: number[] }) {
  const ss: number[] = []; const oo: number[] = []; const hh: number[] = [];
  for (let k = 0; k < src.n.length; k++) {
    const st = stationOf(r, src.n[k], src.e[k]);
    if (st.outside) continue;
    ss.push(st.s); oo.push(st.off); hh.push(src.h[k]);
  }
  const order = ss.map((_, k) => k).sort((a, b) => ss[a] - ss[b]);
  const S = order.map((k) => ss[k]); const O = order.map((k) => oo[k]); const H = order.map((k) => hh[k]);
  const off: number[] = []; const h: number[] = [];
  let j = 0;
  for (const s of r.pk) {
    while (j < S.length - 2 && S[j + 1] < s) j++;
    if (S.length < 2 || s < S[0] - 1 || s > S[S.length - 1] + 1) { off.push(NaN); h.push(NaN); continue; }
    const span = S[j + 1] - S[j];
    const t = span > 0 ? Math.max(0, Math.min(1, (s - S[j]) / span)) : 0;
    off.push(O[j] + t * (O[j + 1] - O[j]));
    h.push(H[j] + t * (H[j + 1] - H[j]));
  }
  return { off, h };
}

export function buildRoad(name: string, axisTxt: string): Road {
  const a = parseLineTxt(axisTxt);
  return { name, ...a, lines: {} };
}

export function withLine(r: Road, key: SideLine, txt: string): Road {
  const l = attachLine(r, parseLineTxt(txt));
  const sideOk = l.off.filter(Number.isFinite);
  if (!sideOk.length) throw new Error('Линия не легла вдоль оси — проверьте, тот ли файл');
  const mean = sideOk.reduce((x, y) => x + y, 0) / sideOk.length;
  if ((key.endsWith('L') && mean > 0) || (key.endsWith('R') && mean < 0)) {
    throw new Error(`Линия лежит ${mean > 0 ? 'справа' : 'слева'} от оси (в среднем ${mean.toFixed(2)} м) — выбрана не та сторона?`);
  }
  return { ...r, lines: { ...r.lines, [key]: l } };
}

// ---------- хранение: файл на проект, как подложка ----------

const cache = new Map<string, Road | null>();
const listeners = new Set<(pid: string) => void>();
const file = (pid: string) => new File(Paths.document, `road_${pid}.json`);

export async function loadRoad(pid: string): Promise<Road | null> {
  if (cache.has(pid)) return cache.get(pid)!;
  const f = file(pid);
  let r: Road | null = null;
  if (f.exists) {
    try { r = JSON.parse(await f.text(), (_k, v) => (v === null ? NaN : v)) as Road; } catch { r = null; }
  }
  cache.set(pid, r);
  return r;
}

/** Без чтения файла — для обработчиков, где ждать нельзя (голос после замера). */
export function roadCached(pid: string | undefined): Road | null {
  return pid ? cache.get(pid) ?? null : null;
}

export function saveRoad(pid: string, r: Road | null) {
  const f = file(pid);
  if (f.exists) f.delete();
  if (r) { f.create(); f.write(JSON.stringify(r)); } // NaN пишется как null и читается обратно
  cache.set(pid, r);
  listeners.forEach((l) => l(pid));
}

export function onRoadChange(l: (pid: string) => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Строка для живой позиции: «ПК 12+34.5 · → 3.40 · проект 1036.120 · Δ +12 мм». */
export function liveRoadText(r: Road, l: { north: number; east: number; height: number }) {
  const st = stationOf(r, l.north, l.east);
  const hd = designAt(r, st);
  const parts = [`ПК ${fmtPk(st.s, 1)}`, `${st.off >= 0 ? '→' : '←'} ${Math.abs(st.off).toFixed(2)}`];
  if (st.outside) parts.push('за осью');
  if (hd != null) {
    const dh = (l.height - hd) * 1000;
    parts.push(`пр. ${hd.toFixed(3)}`, `Δ ${dh >= 0 ? '+' : ''}${dh.toFixed(0)} мм`);
  }
  return parts.join(' · ');
}
