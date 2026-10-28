import type { FeatureCode, SurveyPoint } from '../db/types';
import { buildCodeLines } from './codeLines';

/** Кириллица в DXF R12 — через \U+XXXX: файл ASCII, AutoCAD читает при любой кодовой странице. */
const dxfText = (s: string) => s.replace(/[^\x20-\x7e]/g, (c) => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
const layerName = (s: string) => (s.replace(/[^A-Za-z0-9_-]/g, '_') || 'POINTS').slice(0, 31);

const ACI: Array<[number, number, number, number]> = [
  [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255],
  [30, 255, 127, 0], [40, 255, 191, 0], [150, 0, 127, 255], [190, 191, 0, 255], [8, 128, 128, 128],
];
function aciOf(hex: string | undefined): number {
  const m = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return 7;
  const [r, g, b] = [1, 2, 3].map((k) => parseInt(m[k], 16));
  let best = 7; let bd = Infinity;
  for (const [i, R, G, B] of ACI) { const d = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

/**
 * DXF R12 всей съёмки в местных координатах (x = E, y = N): точки (POINT, имя и высота текстом)
 * по слоям кодов и линии по коду (POLYLINE) на слоях «<код>_LINE». Точки без местных координат пропускаются.
 */
export function surveyDxf(points: SurveyPoint[], codes: FeatureCode[], lineCodes: string[], gap: number): { text: string; count: number } {
  const e: string[] = [];
  const put = (...kv: Array<string | number>) => { for (let i = 0; i < kv.length; i += 2) e.push(String(kv[i]), String(kv[i + 1])); };
  const fx = (v: number) => v.toFixed(3);
  const colorOf = (code: string) => aciOf(codes.find((c) => c.code === code)?.color);

  const placed = points.filter((p) => p.north != null && p.east != null);
  const lines = buildCodeLines(placed, lineCodes, gap);

  put(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC');
  put(0, 'SECTION', 2, 'ENTITIES');
  for (const p of placed) {
    const layer = layerName(p.code || 'POINTS');
    const c = colorOf(p.code);
    const h = p.height ?? p.elevation;
    put(0, 'POINT', 8, layer, 62, c, 10, fx(p.east!), 20, fx(p.north!), 30, fx(h));
    put(0, 'TEXT', 8, layer, 62, c, 10, fx(p.east! + 0.3), 20, fx(p.north! + 0.3), 30, 0, 40, 0.5, 1, dxfText(p.name), 50, '0.00');
    put(0, 'TEXT', 8, layer, 62, c, 10, fx(p.east! + 0.3), 20, fx(p.north! - 0.4), 30, 0, 40, 0.4, 1, dxfText(h.toFixed(2)), 50, '0.00');
  }
  for (const l of lines) {
    const layer = layerName(l.code) + '_LINE';
    put(0, 'POLYLINE', 8, layer, 62, colorOf(l.code), 66, 1, 70, 0);
    for (const v of l.pts) put(0, 'VERTEX', 8, layer, 10, fx(v.east), 20, fx(v.north), 30, fx(v.height));
    put(0, 'SEQEND', 8, layer);
  }
  put(0, 'ENDSEC', 0, 'EOF');
  return { text: e.join('\r\n') + '\r\n', count: placed.length };
}
