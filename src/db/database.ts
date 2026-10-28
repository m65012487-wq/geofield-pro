import * as SQLite from 'expo-sqlite';
import type { Project, SurveyPoint, Feature, FeatureCode, Vertex } from './types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync('geofield.db');
  return dbPromise;
}

const DEFAULT_CODES: Array<[string, string, string]> = [
  ['STN', 'Станция/репер', '#B6F94B'],
  ['УГОЛ', 'Угол здания/участка', '#4BC0F9'],
  ['СТЛБ', 'Столб', '#F9A64B'],
  ['КЛДЦ', 'Колодец', '#F94B7E'],
  ['ДРВ', 'Дерево', '#3DDC84'],
  ['ЗАБОР', 'Ограждение', '#B08CFF'],
  ['ДОР', 'Кромка дороги', '#FFD24B'],
];

export async function initDatabase(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      crs TEXT NOT NULL DEFAULT 'WGS84',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS points (
      id TEXT PRIMARY KEY NOT NULL,
      projectId TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      elevation REAL NOT NULL DEFAULT 0,
      quality TEXT NOT NULL DEFAULT 'single',
      hAccuracy REAL NOT NULL DEFAULT 0,
      vAccuracy REAL NOT NULL DEFAULT 0,
      epochs INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_points_project ON points(projectId);
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY NOT NULL,
      projectId TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      vertices TEXT NOT NULL DEFAULT '[]',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_features_project ON features(projectId);
    CREATE TABLE IF NOT EXISTS codes (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#B6F94B'
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  // Заполняем библиотеку кодов при первом запуске
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM codes');
  if ((row?.c ?? 0) === 0) {
    for (const [code, desc, color] of DEFAULT_CODES) {
      await db.runAsync(
        'INSERT INTO codes (id, code, description, color) VALUES (?, ?, ?, ?)',
        [uid(), code, desc, color]
      );
    }
  }
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- KV (настройки, активный проект) ----------

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// ---------- Проекты ----------

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.getAllAsync<Project & { pointCount: number }>(`
    SELECT p.*, COUNT(pt.id) AS pointCount
    FROM projects p LEFT JOIN points pt ON pt.projectId = p.id
    GROUP BY p.id ORDER BY p.updatedAt DESC
  `);
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();
  return (await db.getFirstAsync<Project>('SELECT * FROM projects WHERE id = ?', [id])) ?? null;
}

export async function createProject(name: string, description: string, crs: string): Promise<Project> {
  const db = await getDb();
  const now = Date.now();
  const p: Project = { id: uid(), name, description, crs, createdAt: now, updatedAt: now };
  await db.runAsync(
    'INSERT INTO projects (id, name, description, crs, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [p.id, p.name, p.description, p.crs, now, now]
  );
  return p;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM points WHERE projectId = ?', [id]);
  await db.runAsync('DELETE FROM features WHERE projectId = ?', [id]);
  await db.runAsync('DELETE FROM projects WHERE id = ?', [id]);
}

async function touchProject(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE projects SET updatedAt = ? WHERE id = ?', [Date.now(), id]);
}

// ---------- Точки ----------

export async function listPoints(projectId: string, search = ''): Promise<SurveyPoint[]> {
  const db = await getDb();
  if (search.trim()) {
    const q = `%${search.trim()}%`;
    return db.getAllAsync<SurveyPoint>(
      'SELECT * FROM points WHERE projectId = ? AND (name LIKE ? OR code LIKE ?) ORDER BY createdAt DESC',
      [projectId, q, q]
    );
  }
  return db.getAllAsync<SurveyPoint>(
    'SELECT * FROM points WHERE projectId = ? ORDER BY createdAt DESC',
    [projectId]
  );
}

export async function getPoint(id: string): Promise<SurveyPoint | null> {
  const db = await getDb();
  return (await db.getFirstAsync<SurveyPoint>('SELECT * FROM points WHERE id = ?', [id])) ?? null;
}

export async function countPoints(projectId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM points WHERE projectId = ?', [projectId]
  );
  return row?.c ?? 0;
}

export async function addPoint(p: Omit<SurveyPoint, 'id' | 'createdAt'>): Promise<SurveyPoint> {
  const db = await getDb();
  const point: SurveyPoint = { ...p, id: uid(), createdAt: Date.now() };
  await db.runAsync(
    `INSERT INTO points (id, projectId, name, code, latitude, longitude, elevation, quality, hAccuracy, vAccuracy, epochs, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [point.id, point.projectId, point.name, point.code, point.latitude, point.longitude,
     point.elevation, point.quality, point.hAccuracy, point.vAccuracy, point.epochs, point.note, point.createdAt]
  );
  await touchProject(point.projectId);
  return point;
}

export async function updatePoint(id: string, fields: Partial<Pick<SurveyPoint, 'name' | 'code' | 'note' | 'elevation'>>): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v as string | number);
  }
  if (!sets.length) return;
  vals.push(id);
  await db.runAsync(`UPDATE points SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export async function deletePoint(id: string, projectId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM points WHERE id = ?', [id]);
  await touchProject(projectId);
}

export async function suggestPointName(projectId: string): Promise<string> {
  const n = await countPoints(projectId);
  return 'PT' + String(n + 1).padStart(3, '0');
}

// ---------- Линии и полигоны ----------

interface FeatureRow {
  id: string; projectId: string; type: 'line' | 'polygon';
  name: string; code: string; vertices: string; createdAt: number;
}

function rowToFeature(r: FeatureRow): Feature {
  return { ...r, vertices: JSON.parse(r.vertices) as Vertex[] };
}

export async function listFeatures(projectId: string, type?: 'line' | 'polygon'): Promise<Feature[]> {
  const db = await getDb();
  const rows = type
    ? await db.getAllAsync<FeatureRow>(
        'SELECT * FROM features WHERE projectId = ? AND type = ? ORDER BY createdAt DESC', [projectId, type])
    : await db.getAllAsync<FeatureRow>(
        'SELECT * FROM features WHERE projectId = ? ORDER BY createdAt DESC', [projectId]);
  return rows.map(rowToFeature);
}

export async function addFeature(f: Omit<Feature, 'id' | 'createdAt'>): Promise<Feature> {
  const db = await getDb();
  const feat: Feature = { ...f, id: uid(), createdAt: Date.now() };
  await db.runAsync(
    'INSERT INTO features (id, projectId, type, name, code, vertices, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [feat.id, feat.projectId, feat.type, feat.name, feat.code, JSON.stringify(feat.vertices), feat.createdAt]
  );
  await touchProject(feat.projectId);
  return feat;
}

export async function deleteFeature(id: string, projectId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM features WHERE id = ?', [id]);
  await touchProject(projectId);
}

export async function countFeatures(projectId: string, type: 'line' | 'polygon'): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM features WHERE projectId = ? AND type = ?', [projectId, type]
  );
  return row?.c ?? 0;
}

// ---------- Коды ----------

export async function listCodes(): Promise<FeatureCode[]> {
  const db = await getDb();
  return db.getAllAsync<FeatureCode>('SELECT * FROM codes ORDER BY code');
}

export async function addCode(code: string, description: string, color: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO codes (id, code, description, color) VALUES (?, ?, ?, ?)',
    [uid(), code, description, color]);
}

export async function deleteCode(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM codes WHERE id = ?', [id]);
}
