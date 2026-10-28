import type { SurveyPoint } from '../db/types';

export interface CodeLine { code: string; pts: Array<{ north: number; east: number; height: number }> }

export const DEFAULT_LINE_GAP = 30;

/** Список кодов-линий из kv 'lineCodes' (через запятую). */
export function parseLineCodes(v: string | null | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Линии по коду: точки кода идут по порядку съёмки (createdAt), линия рвётся там,
 * где соседние точки дальше друг от друга, чем gap метров. Линия короче двух точек не нужна.
 */
export function buildCodeLines(points: SurveyPoint[], lineCodes: string[], gap: number): CodeLine[] {
  const res: CodeLine[] = [];
  const sorted = [...points].sort((a, b) => a.createdAt - b.createdAt);
  for (const code of lineCodes) {
    let cur: CodeLine['pts'] = [];
    const flush = () => { if (cur.length >= 2) res.push({ code, pts: cur }); cur = []; };
    for (const p of sorted) {
      if (p.code !== code || p.north == null || p.east == null) continue;
      const q = { north: p.north, east: p.east, height: p.height ?? p.elevation };
      const prev = cur[cur.length - 1];
      if (prev && Math.hypot(q.north - prev.north, q.east - prev.east) > gap) flush();
      cur.push(q);
    }
    flush();
  }
  return res;
}
