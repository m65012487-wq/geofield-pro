import { kvGet, kvSet } from '../db/database';

/** Слой материала. Числа хранятся строками — как их вводят в полях (с запятой или точкой). */
export interface MatLayer {
  id: string;
  name: string;
  /** Толщина, см. */
  thick: string;
  /** 'm3' — объём = площадь × толщина × коэффициент; 't' — масса = площадь × расход, т/м². */
  mode: 'm3' | 't';
  /** Коэффициент уплотнения/насыпного (m3) или расход, т/м² (t). */
  k: string;
}

export const MAT_KEY = 'matLayers';

/** Дорожная одежда съезда, 51 см. */
export function defaultLayers(): MatLayer[] {
  return [
    { id: 'pgs', name: 'ПГС', thick: '25', mode: 'm3', k: '1,2667' },
    { id: 'sch1200', name: 'Щебень М1200 фр. 40–70', thick: '5', mode: 'm3', k: '1,26' },
    { id: 'sch600', name: 'Щебень М600 фр. 20–40', thick: '10', mode: 'm3', k: '1,26' },
    { id: 'ab22', name: 'А/б А22НН', thick: '6', mode: 't', k: '0,1389' },
    { id: 'ab16', name: 'А/б А16ВН', thick: '5', mode: 't', k: '0,1208' },
  ];
}

export async function loadLayers(): Promise<MatLayer[]> {
  const raw = await kvGet(MAT_KEY);
  if (!raw) return defaultLayers();
  try {
    const v = JSON.parse(raw) as MatLayer[];
    if (Array.isArray(v) && v.every((l) => l && typeof l.name === 'string')) return v;
  } catch { /* битая запись — берём по умолчанию */ }
  return defaultLayers();
}

export async function saveLayers(layers: MatLayer[]): Promise<void> {
  await kvSet(MAT_KEY, JSON.stringify(layers));
}

const num = (s: string) => parseFloat(String(s).replace(',', '.').trim());

export interface LayerResult { layer: MatLayer; qty: number; unit: 'м³' | 'т'; ok: boolean }

/** Количество материала слоя на площадь area, м². */
export function layerQty(l: MatLayer, area: number): LayerResult {
  const k = num(l.k), t = num(l.thick);
  if (l.mode === 't') {
    return { layer: l, unit: 'т', ok: Number.isFinite(k), qty: Number.isFinite(k) ? area * k : 0 };
  }
  const ok = Number.isFinite(t) && Number.isFinite(k);
  return { layer: l, unit: 'м³', ok, qty: ok ? area * (t / 100) * k : 0 };
}
