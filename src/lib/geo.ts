/** Геодезические вспомогательные функции для прототипа. */

/** Радиус Земли (WGS84, средний), м. */
const R = 6378137;

/** Расстояние между двумя точками по формуле гаверсинуса, м. */
export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Азимут от точки 1 к точке 2, градусы (0–360, от севера по часовой). */
export function bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Перевод lat/lon в локальные метры относительно опорной точки (для холста). */
export function toLocalMeters(
  refLat: number,
  refLon: number,
  lat: number,
  lon: number
): { x: number; y: number } {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x = haversine(refLat, refLon, refLat, lon) * (lon >= refLon ? 1 : -1);
  const y = haversine(refLat, refLon, lat, refLon) * (lat >= refLat ? 1 : -1);
  return { x, y };
}

/** Форматирует широту/долготу в градусы с 6 знаками. */
export function fmtCoord(v: number): string {
  return v.toFixed(6) + '°';
}

/** Форматирует метры с нужной точностью. */
export function fmtMeters(v: number, digits = 3): string {
  return v.toFixed(digits) + ' м';
}

/** Длина полилинии из географических вершин, м. */
export function geoLength(vertices: { lat: number; lon: number }[]): number {
  let s = 0;
  for (let i = 1; i < vertices.length; i++) {
    s += haversine(vertices[i - 1].lat, vertices[i - 1].lon, vertices[i].lat, vertices[i].lon);
  }
  return s;
}

/** Площадь полигона из географических вершин через локальную проекцию, м². */
export function geoArea(vertices: { lat: number; lon: number }[]): number {
  if (vertices.length < 3) return 0;
  const ref = vertices[0];
  const local = vertices.map((v) => toLocalMeters(ref.lat, ref.lon, v.lat, v.lon));
  let s = 0;
  for (let i = 0; i < local.length; i++) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Периметр замкнутого полигона из географических вершин, м. */
export function geoPerimeter(vertices: { lat: number; lon: number }[]): number {
  if (vertices.length < 2) return 0;
  return geoLength([...vertices, vertices[0]]);
}
