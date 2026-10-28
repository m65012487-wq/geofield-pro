import { getDb, kvGet, kvSet, getProject } from '../db/database';
import type { Project, SurveyPoint, Feature, KnownPoint, FeatureCode } from '../db/types';
import { loadCalib, saveCalib } from './calibStore';
import type { CalibPair } from './calib';
import { addRoad, loadRoads, setActiveRoad, type Road, type RoadSet } from './road';
import { loadBasemap, saveBasemap, type Basemap } from './basemap';
import { loadTg, sendTelegram } from './roadExport';
import { sanitizeName, shareFile, writeCacheFile } from './exporter';

/**
 * Копия проекта и обмен между телефонами. Один JSON-файл: проект, точки, линии, реперы, коды,
 * калибровка, трассы и (по желанию) подложка. Фото и голос не входят.
 */
export interface BackupPack {
  format: 'geofield-backup';
  version: 1;
  createdAt: number;
  device: string;
  project: Project;
  points: SurveyPoint[];
  features: Feature[];
  known: KnownPoint[];
  codes: FeatureCode[];
  /** Сырая запись kv `calib:<pid>` (JSON-строка) или null. */
  calib: string | null;
  roads: RoadSet;
  basemap: Basemap | null;
}

export interface MergeReport {
  added: { points: number; features: number; known: number; codes: number };
  skipped: { points: number; features: number; known: number; codes: number };
  /** Переименованные входящие точки. */
  renamed: Array<{ from: string; to: string }>;
  /** 'taken' — взята из пакета, 'kept' — оставлена своя, 'none' — в пакете нет. */
  calib: 'taken' | 'kept' | 'none';
  roads: 'taken' | 'kept' | 'none';
  basemap: 'taken' | 'kept' | 'none';
  /** id проекта, в который слито. */
  projectId: string;
}

export type ImportMode = 'auto' | 'current' | 'separate';

const MIME = 'application/json';

function today(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- чистая логика слияния (без БД) ----------

export interface MergeInput {
  /** Точки, уже лежащие в целевом проекте: id и имя. */
  ownPoints: Array<{ id: string; name: string }>;
  /** Все id во всей БД (в т.ч. других проектов) — чтобы не получить конфликт ключа. */
  usedIds: { points: Set<string>; features: Set<string>; known: Set<string> };
  ownFeatureIds: Set<string>;
  ownKnownIds: Set<string>;
  ownCodes: Set<string>;
  pack: Pick<BackupPack, 'points' | 'features' | 'known' | 'codes'> & { device?: string };
  /** Новый id, если входящий занят в другом проекте. */
  newId: () => string;
}

export interface MergePlan {
  points: SurveyPoint[];
  features: Feature[];
  known: KnownPoint[];
  codes: FeatureCode[];
  skipped: MergeReport['skipped'];
  renamed: MergeReport['renamed'];
}

/** Что именно добавить. Имя точки занято другой точкой → `<имя>-<метка устройства пакета>`. */
export function planMerge(inp: MergeInput): MergePlan {
  const tag = (inp.pack.device ?? '').trim() || 'Б';
  const names = new Set(inp.ownPoints.map((p) => p.name));
  const ownIds = new Set(inp.ownPoints.map((p) => p.id));
  const skipped = { points: 0, features: 0, known: 0, codes: 0 };
  const renamed: MergePlan['renamed'] = [];
  const points: SurveyPoint[] = [];
  for (const p of inp.pack.points) {
    if (ownIds.has(p.id)) { skipped.points++; continue; }
    let name = p.name;
    if (names.has(name)) {
      let cand = `${p.name}-${tag}`;
      for (let k = 2; names.has(cand); k++) cand = `${p.name}-${tag}${k}`;
      renamed.push({ from: p.name, to: cand });
      name = cand;
    }
    names.add(name);
    const id = inp.usedIds.points.has(p.id) ? inp.newId() : p.id;
    inp.usedIds.points.add(id);
    points.push({ ...p, id, name, photo: '', voice: '' });
  }
  const features: Feature[] = [];
  for (const f of inp.pack.features) {
    if (inp.ownFeatureIds.has(f.id)) { skipped.features++; continue; }
    const id = inp.usedIds.features.has(f.id) ? inp.newId() : f.id;
    inp.usedIds.features.add(id);
    features.push({ ...f, id });
  }
  const known: KnownPoint[] = [];
  for (const k of inp.pack.known) {
    if (inp.ownKnownIds.has(k.id)) { skipped.known++; continue; }
    const id = inp.usedIds.known.has(k.id) ? inp.newId() : k.id;
    inp.usedIds.known.add(id);
    known.push({ ...k, id });
  }
  const codes: FeatureCode[] = [];
  const have = new Set(inp.ownCodes);
  for (const c of inp.pack.codes) {
    if (have.has(c.code)) { skipped.codes++; continue; }
    have.add(c.code);
    codes.push(c);
  }
  return { points, features, known, codes, skipped, renamed };
}

// ---------- сборка и отправка ----------

export async function buildBackup(pid: string, opts: { withBasemap?: boolean } = {}): Promise<string> {
  const db = await getDb();
  const project = await getProject(pid);
  if (!project) throw new Error('Проект не найден');
  const points = await db.getAllAsync<SurveyPoint>('SELECT * FROM points WHERE projectId = ? ORDER BY createdAt', [pid]);
  const rawFeatures = await db.getAllAsync<Feature & { vertices: unknown }>('SELECT * FROM features WHERE projectId = ? ORDER BY createdAt', [pid]);
  const features = rawFeatures.map((f) => ({
    ...f, vertices: typeof f.vertices === 'string' ? JSON.parse(f.vertices) : f.vertices,
  })) as Feature[];
  const known = await db.getAllAsync<KnownPoint>('SELECT * FROM known_points WHERE projectId = ?', [pid]);
  const codes = await db.getAllAsync<FeatureCode>('SELECT * FROM codes');
  const pack: BackupPack = {
    format: 'geofield-backup', version: 1, createdAt: Date.now(),
    device: (await kvGet('deviceTag')) ?? '',
    project,
    points: points.map((p) => ({ ...p, photo: '', voice: '' })),
    features, known, codes,
    calib: await kvGet(`calib:${pid}`),
    roads: await loadRoads(pid),
    basemap: opts.withBasemap ? await loadBasemap(pid) : null,
  };
  return JSON.stringify(pack);
}

async function markSent(pid: string) {
  await kvSet(`lastBackup:${pid}`, today());
  await kvSet(`lastBackupAt:${pid}`, String(Date.now()));
}

export async function lastBackupDate(pid: string): Promise<string | null> {
  return kvGet(`lastBackup:${pid}`);
}

/** Отправляет копию: в Telegram, если бот настроен, иначе через «Поделиться». */
export async function sendBackup(pid: string, opts: { withBasemap?: boolean } = {}): Promise<'telegram' | 'share'> {
  const project = await getProject(pid);
  if (!project) throw new Error('Проект не найден');
  const json = await buildBackup(pid, opts);
  const name = `${sanitizeName(project.name)}_копия_${today()}.geofield.json`;
  const file = writeCacheFile(name, json);
  const cfg = await loadTg();
  let how: 'telegram' | 'share';
  if (cfg) {
    const tag = (await kvGet('deviceTag')) || '';
    await sendTelegram(cfg, file, name, MIME, `Копия проекта «${project.name}»${tag ? `, устройство ${tag}` : ''}`);
    how = 'telegram';
  } else {
    await shareFile(file, MIME, name);
    how = 'share';
  }
  await markSent(pid);
  return how;
}

/** Тихая ежедневная копия в Telegram. Ошибки не бросает. */
export async function maybeAutoBackup(pid: string): Promise<'sent' | 'skipped' | 'error'> {
  try {
    if ((await kvGet('autoBackup')) !== '1') return 'skipped';
    if (!(await loadTg())) return 'skipped';
    if ((await kvGet(`lastBackup:${pid}`)) === today()) return 'skipped';
    const db = await getDb();
    const at = parseInt((await kvGet(`lastBackupAt:${pid}`)) ?? '0', 10) || 0;
    const row = await db.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM points WHERE projectId = ? AND createdAt > ?', [pid, at]);
    if (!row || row.c === 0) return 'skipped';
    const withBasemap = (await kvGet('backupBasemap')) === '1';
    await sendBackup(pid, { withBasemap });
    return 'sent';
  } catch {
    return 'error';
  }
}

// ---------- импорт ----------

/** Разбор и проверка файла; бросает понятную ошибку. */
export function parseBackup(text: string): BackupPack {
  let raw: Partial<BackupPack>;
  try {
    // null в трассе — это NaN (как в road.ts)
    raw = JSON.parse(text, (k, x) => (x === null && /^(pk|n|e|h|off)$/.test(k) ? NaN : x));
  } catch {
    throw new Error('Это не файл копии GeoField (не читается)');
  }
  if (!raw || raw.format !== 'geofield-backup') throw new Error('Это не файл копии GeoField');
  if (raw.version !== 1) throw new Error('Файл сделан более новой версией программы');
  if (!raw.project?.id) throw new Error('В копии нет проекта');
  return {
    ...(raw as BackupPack),
    points: raw.points ?? [], features: raw.features ?? [], known: raw.known ?? [], codes: raw.codes ?? [],
    calib: raw.calib ?? null,
    roads: raw.roads && Array.isArray(raw.roads.list) ? raw.roads : { active: 0, list: [] },
    basemap: raw.basemap ?? null,
    device: raw.device ?? '',
  };
}

/**
 * Слияние копии в проект. 'auto': проект с тем же id есть — в него, иначе создаётся с этим id.
 * 'current': в проект currentPid. 'separate': отдельный новый проект.
 */
export async function importBackup(
  text: string,
  opts: { mode?: ImportMode; currentPid?: string } = {}
): Promise<MergeReport> {
  const pack = parseBackup(text);
  const db = await getDb();
  const mode = opts.mode ?? 'auto';

  let pid: string;
  let createProject = false;
  let projectName = pack.project.name;
  if (mode === 'current') {
    if (!opts.currentPid || !(await getProject(opts.currentPid))) throw new Error('Нет текущего проекта');
    pid = opts.currentPid;
  } else if (mode === 'separate') {
    pid = (await getProject(pack.project.id)) ? uid() : pack.project.id;
    createProject = true;
    projectName = `${pack.project.name} (из копии${pack.device ? ' ' + pack.device : ''})`;
  } else {
    pid = pack.project.id;
    createProject = !(await getProject(pid));
  }

  const ids = async (table: string) =>
    new Set((await db.getAllAsync<{ id: string }>(`SELECT id FROM ${table}`)).map((r) => r.id));
  const own = async (table: string) =>
    new Set((await db.getAllAsync<{ id: string }>(`SELECT id FROM ${table} WHERE projectId = ?`, [pid])).map((r) => r.id));

  const ownPoints = await db.getAllAsync<{ id: string; name: string }>('SELECT id, name FROM points WHERE projectId = ?', [pid]);
  const plan = planMerge({
    ownPoints,
    usedIds: { points: await ids('points'), features: await ids('features'), known: await ids('known_points') },
    ownFeatureIds: await own('features'),
    ownKnownIds: await own('known_points'),
    ownCodes: new Set((await db.getAllAsync<{ code: string }>('SELECT code FROM codes')).map((c) => c.code)),
    pack,
    newId: uid,
  });

  await db.withTransactionAsync(async () => {
    if (createProject) {
      const now = Date.now();
      await db.runAsync(
        'INSERT INTO projects (id, name, description, crs, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
        [pid, projectName, pack.project.description ?? '', pack.project.crs ?? 'WGS84', pack.project.createdAt ?? now, now]
      );
    } else {
      await db.runAsync('UPDATE projects SET updatedAt = ? WHERE id = ?', [Date.now(), pid]);
    }
    for (const p of plan.points) {
      await db.runAsync(
        `INSERT INTO points (id, projectId, name, code, latitude, longitude, elevation, quality, hAccuracy, vAccuracy,
           epochs, note, createdAt, north, east, height, stage, photo, voice)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')`,
        [p.id, pid, p.name, p.code ?? '', p.latitude, p.longitude, p.elevation ?? 0, p.quality ?? 'single',
          p.hAccuracy ?? 0, p.vAccuracy ?? 0, p.epochs ?? 1, p.note ?? '', p.createdAt,
          p.north ?? null, p.east ?? null, p.height ?? null, p.stage ?? '']
      );
    }
    for (const f of plan.features) {
      await db.runAsync(
        'INSERT INTO features (id, projectId, type, name, code, vertices, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [f.id, pid, f.type, f.name, f.code ?? '', JSON.stringify(f.vertices ?? []), f.createdAt]
      );
    }
    for (const k of plan.known) {
      await db.runAsync(
        'INSERT INTO known_points (id, projectId, name, north, east, height) VALUES (?, ?, ?, ?, ?, ?)',
        [k.id, pid, k.name, k.north, k.east, k.height]
      );
    }
    for (const c of plan.codes) {
      await db.runAsync('INSERT INTO codes (id, code, description, color) VALUES (?, ?, ?, ?)',
        [uid(), c.code, c.description ?? '', c.color ?? '#B6F94B']);
    }
  });

  // калибровка, трассы, подложка: берём из пакета только если у нас пусто (файлы и кэш — вне БД-транзакции)
  let calib: MergeReport['calib'] = 'none';
  let theirPairs: CalibPair[] = [];
  try { theirPairs = (pack.calib ? JSON.parse(pack.calib).pairs : []) ?? []; } catch { theirPairs = []; }
  if ((await loadCalib(pid)).pairs.length === 0) {
    if (theirPairs.length) { await saveCalib(pid, theirPairs); calib = 'taken'; }
  } else if (theirPairs.length) calib = 'kept';

  let roads: MergeReport['roads'] = 'none';
  const ownRoads = await loadRoads(pid);
  if (ownRoads.list.length === 0) {
    if (pack.roads.list.length) {
      pack.roads.list.forEach((r: Road) => addRoad(pid, r));
      setActiveRoad(pid, pack.roads.active);
      roads = 'taken';
    }
  } else if (pack.roads.list.length) roads = 'kept';

  let basemap: MergeReport['basemap'] = 'none';
  if (pack.basemap) {
    if (await loadBasemap(pid)) basemap = 'kept';
    else { saveBasemap(pid, pack.basemap); basemap = 'taken'; }
  }

  return {
    added: { points: plan.points.length, features: plan.features.length, known: plan.known.length, codes: plan.codes.length },
    skipped: plan.skipped, renamed: plan.renamed, calib, roads, basemap, projectId: pid,
  };
}
