import type { FixQuality } from '../db/types';

/** Эпоха из GGA (+ оценка точности из GST, если приёмник её шлёт). */
export interface NmeaEpoch {
  latitude: number;
  longitude: number;
  /** Высота над геоидом по модели приёмника, м. */
  altitude: number;
  /** Превышение геоида над эллипсоидом, м (эллипсоидальная = altitude + geoidSep). */
  geoidSep: number;
  /** Код качества GGA: 0 нет, 1 автономно, 2 DGPS, 4 FIX, 5 FLOAT. */
  ggaQuality: number;
  quality: FixQuality;
  satellites: number;
  hdop: number;
  /** Возраст поправок, с; -1 если нет. */
  diffAge: number;
  /** σ по северу/востоку/высоте из GST, м; null если приёмник не шлёт GST. */
  sigmaN: number | null;
  sigmaE: number | null;
  sigmaH: number | null;
  utc: string;
}

export function ggaToQuality(q: number): FixQuality {
  if (q === 4) return 'fix';
  if (q === 5) return 'float';
  if (q === 1 || q === 2 || q === 9) return 'single';
  return 'none';
}

export function checksumOk(line: string): boolean {
  const star = line.indexOf('*');
  if (star < 0) return true;
  if (star + 3 > line.length) return false;
  let sum = 0;
  for (let i = 1; i < star; i++) sum ^= line.charCodeAt(i);
  return sum === parseInt(line.substring(star + 1, star + 3), 16);
}

/** ддмм.мммм + полушарие -> градусы */
export function nmeaDeg(v: string, hemi: string): number {
  if (!v) return NaN;
  const x = parseFloat(v);
  const d = Math.floor(x / 100);
  const res = d + (x - d * 100) / 60;
  return hemi === 'S' || hemi === 'W' ? -res : res;
}

function num(v: string | undefined, def: number): number {
  if (v === undefined || v === '') return def;
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : def;
}

/**
 * Построчный разбор потока: GST запоминается и подмешивается в следующую GGA.
 * feed() возвращает эпоху, когда пришла GGA, иначе null.
 */
export class NmeaParser {
  private sigma: [number, number, number] | null = null;

  feed(raw: string): NmeaEpoch | null {
    const line = raw.trim();
    if (!line.startsWith('$') || !checksumOk(line)) return null;
    const star = line.indexOf('*');
    const f = line.substring(1, star < 0 ? line.length : star).split(',');
    if (!f[0] || f[0].length < 5) return null;
    const type = f[0].substring(2);
    if (type === 'GST' && f.length >= 9) {
      this.sigma = [num(f[6], NaN), num(f[7], NaN), num(f[8], NaN)];
      if (this.sigma.some((s) => !Number.isFinite(s))) this.sigma = null;
      return null;
    }
    if (type !== 'GGA' || f.length < 14) return null;
    const lat = nmeaDeg(f[2], f[3]);
    const lon = nmeaDeg(f[4], f[5]);
    const q = num(f[6], 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return {
      latitude: lat,
      longitude: lon,
      altitude: num(f[9], 0),
      geoidSep: num(f[11], 0),
      ggaQuality: q,
      quality: ggaToQuality(q),
      satellites: num(f[7], 0),
      hdop: num(f[8], 0),
      diffAge: num(f[13], -1),
      sigmaN: this.sigma ? this.sigma[0] : null,
      sigmaE: this.sigma ? this.sigma[1] : null,
      sigmaH: this.sigma ? this.sigma[2] : null,
      utc: f[1],
    };
  }
}
