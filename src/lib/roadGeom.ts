import { designAt, type Road } from './road';

/**
 * Точка по пикету и смещению от оси (вправо по ходу пикетажа «+»).
 * Нормаль — как в stationOf: вправо к направлению (dN, dE), в осях (N, E) это (−dE, dN)/L.
 * За концами оси ось продлевается по крайнему сегменту.
 */
export function pointAt(road: Road, s: number, off: number): { north: number; east: number; hDesign: number | null } {
  const last = road.pk.length - 2;
  let i = 0;
  if (s >= road.pk[last + 1]) i = last;
  else {
    for (let k = 0; k <= last; k++) {
      i = k;
      if (s < road.pk[k + 1] && road.pk[k + 1] > road.pk[k]) break;
    }
  }
  const dN = road.n[i + 1] - road.n[i]; const dE = road.e[i + 1] - road.e[i];
  const L = Math.hypot(dN, dE) || 1;
  const ds = road.pk[i + 1] - road.pk[i] || 1;
  const t = (s - road.pk[i]) / ds;
  const north = road.n[i] + t * dN - (off * dE) / L;
  const east = road.e[i] + t * dE + (off * dN) / L;
  const outside = t < 0 || t > 1;
  const hDesign = designAt(road, { s, off, outside, i, t: Math.max(0, Math.min(1, t)) });
  return { north, east, hDesign };
}
