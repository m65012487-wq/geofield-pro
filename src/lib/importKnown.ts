/**
 * Каталог реперов из файла: LandXML (CgPoint «N E H», выгрузки Leica) или текст
 * «имя,N,E,H» с разделителями , ; табуляция пробел. Строки, где не 3 числа после имени, пропускаются.
 */
export interface ParsedKnown { name: string; north: number; east: number; height: number }

export function parseKnown(text: string): { points: ParsedKnown[]; skipped: number } {
  if (/<CgPoint\b/.test(text)) return parseLandXml(text);
  const points: ParsedKnown[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const f = line.split(/[,;\t ]+/).filter(Boolean);
    if (f.length < 4) { skipped++; continue; }
    const [n, e, h] = f.slice(1, 4).map((v) => parseFloat(v.replace(',', '.')));
    if (![n, e, h].every(Number.isFinite)) { skipped++; continue; }
    points.push({ name: f[0], north: n, east: e, height: h });
  }
  return { points, skipped };
}

function parseLandXml(text: string): { points: ParsedKnown[]; skipped: number } {
  const points: ParsedKnown[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  const re = /<CgPoint\b([^>]*)>([^<]*)<\/CgPoint>/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const name = /name="([^"]*)"/.exec(m[1])?.[1];
    const v = m[2].trim().split(/\s+/).map(Number);
    if (!name || v.length < 3 || !v.slice(0, 3).every(Number.isFinite) || seen.has(name)) { skipped++; continue; }
    seen.add(name);
    points.push({ name, north: v[0], east: v[1], height: v[2] });
  }
  return { points, skipped };
}
