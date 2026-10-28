import { File, Paths } from 'expo-file-system';

/**
 * Подложка из DXF в местных координатах проекта: только линии (LINE, LWPOLYLINE, POLYLINE).
 * В DXF x = восток (E), y = север (N). Хранится JSON-файлом рядом с БД, по проекту.
 */
export interface BaseLine { layer: number; pts: number[] } // pts: [E0, N0, E1, N1, ...]
export interface Basemap {
  name: string;
  layers: Array<{ name: string; color: string; visible: boolean }>;
  lines: BaseLine[];
  bbox: [number, number, number, number]; // minE, minN, maxE, maxN
}

// Цвета ACI 1–9 и серый для остального — на тёмном фоне
const ACI: Record<number, string> = {
  1: '#FF4D4D', 2: '#FFE14D', 3: '#4DFF6A', 4: '#4DFFF0', 5: '#4D8BFF', 6: '#FF4DF0', 7: '#E6E6E6', 8: '#8C8C8C', 9: '#C0C0C0',
};

export function parseDxf(text: string, name: string): Basemap {
  const lines = text.split(/\r?\n/);
  const layerIdx = new Map<string, number>();
  const layers: Basemap['layers'] = [];
  const layerColor = new Map<string, number>();
  const out: BaseLine[] = [];
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;

  // пары (код, значение)
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);

  // таблица слоёв: цвета
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'LAYER') {
      let nm = '', col = 7;
      for (let j = i + 1; j < pairs.length && pairs[j][0] !== 0; j++) {
        if (pairs[j][0] === 2) nm = pairs[j][1];
        if (pairs[j][0] === 62) col = Math.abs(parseInt(pairs[j][1], 10));
      }
      if (nm) layerColor.set(nm, col);
    }
  }
  const layerOf = (nm: string, ownColor: number | null) => {
    const key = nm || '0';
    let idx = layerIdx.get(key);
    if (idx == null) {
      idx = layers.length;
      layerIdx.set(key, idx);
      const c = ownColor ?? layerColor.get(key) ?? 7;
      layers.push({ name: key, color: ACI[c] ?? '#9AA5B1', visible: true });
    }
    return idx;
  };
  const push = (layer: number, pts: number[]) => {
    if (pts.length < 4) return;
    for (let k = 0; k < pts.length; k += 2) {
      minE = Math.min(minE, pts[k]); maxE = Math.max(maxE, pts[k]);
      minN = Math.min(minN, pts[k + 1]); maxN = Math.max(maxN, pts[k + 1]);
    }
    out.push({ layer, pts });
  };

  let inEntities = false;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 2 && v === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION') { inEntities = true; continue; }
    if (c === 0 && v === 'ENDSEC') { inEntities = false; continue; }
    if (!inEntities || c !== 0) continue;
    if (v === 'LINE' || v === 'LWPOLYLINE') {
      let layer = '', color: number | null = null, closed = false;
      const xs: number[] = [], ys: number[] = [];
      let j = i + 1;
      for (; j < pairs.length && pairs[j][0] !== 0; j++) {
        const [cc, vv] = pairs[j];
        if (cc === 8) layer = vv;
        else if (cc === 62) color = Math.abs(parseInt(vv, 10));
        else if (cc === 10 || cc === 11) xs.push(parseFloat(vv));
        else if (cc === 20 || cc === 21) ys.push(parseFloat(vv));
        else if (cc === 70 && v === 'LWPOLYLINE') closed = (parseInt(vv, 10) & 1) === 1;
      }
      const pts: number[] = [];
      for (let k = 0; k < Math.min(xs.length, ys.length); k++) pts.push(xs[k], ys[k]);
      if (closed && pts.length >= 4) pts.push(pts[0], pts[1]);
      push(layerOf(layer, color), pts);
      i = j - 1;
    } else if (v === 'POLYLINE') {
      let layer = '', color: number | null = null, closed = false;
      let j = i + 1;
      for (; j < pairs.length && pairs[j][0] !== 0; j++) {
        if (pairs[j][0] === 8) layer = pairs[j][1];
        if (pairs[j][0] === 62) color = Math.abs(parseInt(pairs[j][1], 10));
        if (pairs[j][0] === 70) closed = (parseInt(pairs[j][1], 10) & 1) === 1;
      }
      const pts: number[] = [];
      while (j < pairs.length && pairs[j][1] === 'VERTEX') {
        let x = NaN, y = NaN;
        let k = j + 1;
        for (; k < pairs.length && pairs[k][0] !== 0; k++) {
          if (pairs[k][0] === 10) x = parseFloat(pairs[k][1]);
          if (pairs[k][0] === 20) y = parseFloat(pairs[k][1]);
        }
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push(x, y);
        j = k;
      }
      if (closed && pts.length >= 4) pts.push(pts[0], pts[1]);
      push(layerOf(layer, color), pts);
      i = j - 1;
    }
  }
  if (!out.length) throw new Error('В DXF не найдено линий (LINE / LWPOLYLINE / POLYLINE)');
  return { name, layers, lines: out, bbox: [minE, minN, maxE, maxN] };
}

const cache = new Map<string, Basemap | null>();
const file = (pid: string) => new File(Paths.document, `basemap_${pid}.json`);

export async function loadBasemap(pid: string): Promise<Basemap | null> {
  if (cache.has(pid)) return cache.get(pid)!;
  const f = file(pid);
  let bm: Basemap | null = null;
  if (f.exists) {
    try { bm = JSON.parse(await f.text()) as Basemap; } catch { bm = null; }
  }
  cache.set(pid, bm);
  return bm;
}

export function saveBasemap(pid: string, bm: Basemap | null) {
  const f = file(pid);
  if (f.exists) f.delete();
  if (bm) { f.create(); f.write(JSON.stringify(bm)); }
  cache.set(pid, bm);
}
