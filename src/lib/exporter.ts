import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Project, SurveyPoint, Feature } from '../db/types';

function sanitize(name: string): string {
  return name.replace(/[^\wа-яА-ЯёЁ-]+/g, '_').slice(0, 40) || 'project';
}

async function writeAndShare(filename: string, content: string, mime: string): Promise<void> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  const can = await Sharing.isAvailableAsync();
  if (!can) throw new Error('Отправка файлов недоступна на этом устройстве');
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: filename });
}

/** Экспорт точек в CSV: имя, код, широта, долгота, высота, точность, качество, дата. */
export async function exportPointsCsv(project: Project, points: SurveyPoint[]): Promise<void> {
  const header = 'Name,Code,North,East,Height,Latitude,Longitude,Elevation,HAccuracy,Quality,Epochs,Note,Timestamp';
  const lines = points.map((p) =>
    [
      p.name, p.code,
      p.north != null ? p.north.toFixed(3) : '', p.east != null ? p.east.toFixed(3) : '', p.height != null ? p.height.toFixed(3) : '',
      p.latitude.toFixed(8), p.longitude.toFixed(8), p.elevation.toFixed(3),
      p.hAccuracy.toFixed(3), p.quality, p.epochs,
      `"${p.note.replace(/"/g, '""')}"`,
      new Date(p.createdAt).toISOString(),
    ].join(',')
  );
  const csv = [header, ...lines].join('\n');
  await writeAndShare(`${sanitize(project.name)}_points.csv`, csv, 'text/csv');
}

/**
 * Каталог в местной системе в том же виде, что выгрузки съёмки объекта: «имя,N,E,H,код» —
 * открывается скриптами и AutoCAD-импортом без переделок. Точки без калибровки пропускаются.
 */
export async function exportLocalTxt(project: Project, points: SurveyPoint[]): Promise<number> {
  const rows = points.filter((p) => p.north != null && p.east != null && p.height != null)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((p) => `${p.name},${p.north!.toFixed(3)},${p.east!.toFixed(3)},${p.height!.toFixed(3)},${p.code}`);
  if (!rows.length) throw new Error('Нет точек с местными координатами — сначала калибровка');
  const CRLF = String.fromCharCode(13, 10);
  await writeAndShare(`${sanitize(project.name)}_NEH.txt`, rows.join(CRLF) + CRLF, 'text/plain');
  return rows.length;
}

/** Экспорт всего проекта в GeoJSON (точки + линии + полигоны). */
export async function exportGeoJson(project: Project, points: SurveyPoint[], features: Feature[]): Promise<void> {
  const fc = {
    type: 'FeatureCollection' as const,
    features: [
      ...points.map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.longitude, p.latitude, p.elevation] },
        properties: {
          name: p.name, code: p.code, quality: p.quality,
          hAccuracy: p.hAccuracy, epochs: p.epochs, note: p.note,
          createdAt: new Date(p.createdAt).toISOString(),
        },
      })),
      ...features.map((f) => ({
        type: 'Feature' as const,
        geometry:
          f.type === 'polygon'
            ? {
                type: 'Polygon' as const,
                coordinates: [[...f.vertices, f.vertices[0]].map((v) => [v.lon, v.lat, v.elev])],
              }
            : {
                type: 'LineString' as const,
                coordinates: f.vertices.map((v) => [v.lon, v.lat, v.elev]),
              },
        properties: { name: f.name, code: f.code, createdAt: new Date(f.createdAt).toISOString() },
      })),
    ],
  };
  await writeAndShare(`${sanitize(project.name)}.geojson`, JSON.stringify(fc, null, 1), 'application/geo+json');
}
