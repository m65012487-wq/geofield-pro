/**
 * Калибровка на местную систему (как «Калибровка план/высота» в LandStar):
 * WGS84 -> поперечная Меркатора (осевой меридиан у объекта) -> 4-параметрический
 * Гельмерт на местные N/E; высота — сдвиг (1–2 пункта) или наклонная плоскость (3+).
 * Местные N/E: N — север (x геодезистов), E — восток (y).
 */

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const D2R = Math.PI / 180;

/** Длина дуги меридиана от экватора. */
function meridian(phi: number): number {
  const e4 = E2 * E2, e6 = e4 * E2;
  return A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi));
}

/** Прямая TM (k0 = 1, без сдвигов): -> {x: на восток, y: на север}. Точность ~мм в пределах ±3° от меридиана. */
export function tmForward(latDeg: number, lonDeg: number, lon0Deg: number): { x: number; y: number } {
  const phi = latDeg * D2R;
  const dl = (lonDeg - lon0Deg) * D2R;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t, C = EP2 * c * c, Aa = c * dl;
  const x = n * (Aa + (1 - T + C) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120);
  const y = meridian(phi) + n * t * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720);
  return { x, y };
}

/** Обратная TM. */
export function tmInverse(x: number, y: number, lon0Deg: number): { lat: number; lon: number } {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const mu = y / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const n1 = A / Math.sqrt(1 - E2 * s * s);
  const r1 = A * (1 - E2) / (1 - E2 * s * s) ** 1.5;
  const T = t * t, C = EP2 * c * c, D = x / n1;
  const lat = phi1 - (n1 * t / r1) * (D * D / 2 - (5 + 3 * T + 10 * C - 4 * C * C - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T + 298 * C + 45 * T * T - 252 * EP2 - 3 * C * C) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T + C) * D ** 3 / 6 + (5 - 2 * C + 28 * T - 3 * C * C + 8 * EP2 + 24 * T * T) * D ** 5 / 120) / c;
  return { lat: lat / D2R, lon: lon0Deg + lon / D2R };
}

/** Пара для калибровки: пункт в местной системе + его измерение приёмником. */
export interface CalibPair {
  name: string;
  north: number; east: number; height: number;
  lat: number; lon: number; h: number;
  useHz: boolean; useV: boolean;
}

export interface Calibration {
  lon0: number;
  /** E = a·x − b·y + tE;  N = b·x + a·y + tN  (x, y — TM восток/север) */
  a: number; b: number; tE: number; tN: number;
  /** dH = h0 + gN·(N − n0) + gE·(E − e0) */
  h0: number; gN: number; gE: number; n0: number; e0: number;
  scale: number; rotationSec: number;
  residuals: Array<{ name: string; dN: number; dE: number; dH: number }>;
}

export function solveCalibration(pairs: CalibPair[]): Calibration {
  const hz = pairs.filter((p) => p.useHz);
  if (hz.length < 2) throw new Error('Для плана нужно минимум 2 пункта');
  const lon0 = Math.round(hz.reduce((s, p) => s + p.lon, 0) / hz.length * 10) / 10;
  const src = hz.map((p) => tmForward(p.lat, p.lon, lon0));
  // центрирование для устойчивости
  const mx = src.reduce((s, q) => s + q.x, 0) / src.length;
  const my = src.reduce((s, q) => s + q.y, 0) / src.length;
  const mE = hz.reduce((s, p) => s + p.east, 0) / hz.length;
  const mN = hz.reduce((s, p) => s + p.north, 0) / hz.length;
  let sxx = 0, sab = 0, sba = 0;
  hz.forEach((p, i) => {
    const x = src[i].x - mx, y = src[i].y - my, E = p.east - mE, N = p.north - mN;
    sxx += x * x + y * y;
    sab += x * E + y * N;
    sba += x * N - y * E;
  });
  const a = sab / sxx, b = sba / sxx;
  const tE = mE - (a * mx - b * my);
  const tN = mN - (b * mx + a * my);

  const vert = pairs.filter((p) => p.useV);
  let h0 = 0, gN = 0, gE = 0, n0 = mN, e0 = mE;
  if (vert.length > 0) {
    n0 = vert.reduce((s, p) => s + p.north, 0) / vert.length;
    e0 = vert.reduce((s, p) => s + p.east, 0) / vert.length;
    const d = vert.map((p) => p.height - p.h);
    h0 = d.reduce((s, v) => s + v, 0) / d.length;
    if (vert.length >= 3) {
      // МНК для наклонной плоскости dH = h0 + gN·dn + gE·de
      let snn = 0, see = 0, sne = 0, snd = 0, sed = 0;
      vert.forEach((p, i) => {
        const dn = p.north - n0, de = p.east - e0, r = d[i] - h0;
        snn += dn * dn; see += de * de; sne += dn * de; snd += dn * r; sed += de * r;
      });
      const det = snn * see - sne * sne;
      if (Math.abs(det) > 1e-6 * Math.max(1, snn * see)) {
        gN = (snd * see - sed * sne) / det;
        gE = (sed * snn - snd * sne) / det;
      }
    }
  }
  const cal: Calibration = {
    lon0, a, b, tE, tN, h0, gN, gE, n0, e0,
    scale: Math.hypot(a, b),
    rotationSec: Math.atan2(b, a) / D2R * 3600,
    residuals: [],
  };
  cal.residuals = pairs.map((p) => {
    const g = toLocal(cal, p.lat, p.lon, p.h);
    return { name: p.name, dN: p.north - g.north, dE: p.east - g.east, dH: p.height - g.height };
  });
  return cal;
}

export function toLocal(c: Calibration, lat: number, lon: number, h: number) {
  const { x, y } = tmForward(lat, lon, c.lon0);
  const east = c.a * x - c.b * y + c.tE;
  const north = c.b * x + c.a * y + c.tN;
  const height = h + c.h0 + c.gN * (north - c.n0) + c.gE * (east - c.e0);
  return { north, east, height };
}

export function fromLocal(c: Calibration, north: number, east: number, height: number) {
  const k = c.a * c.a + c.b * c.b;
  const E = east - c.tE, N = north - c.tN;
  const x = (c.a * E + c.b * N) / k;
  const y = (c.a * N - c.b * E) / k;
  const { lat, lon } = tmInverse(x, y, c.lon0);
  const h = height - (c.h0 + c.gN * (north - c.n0) + c.gE * (east - c.e0));
  return { lat, lon, h };
}
