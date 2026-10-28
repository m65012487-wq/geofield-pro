import type { File } from 'expo-file-system';
import { kvGet } from '../db/database';
import type { FeatureCode, Project, SurveyPoint } from '../db/types';
import { localTxt, sanitizeName, shareFile, writeCacheFile } from './exporter';
import { fmtPk, type Road } from './road';
import { analyse, isBefore, sections, slopes, volumes, type RoadSettings, type Row } from './roadCheck';

/**
 * Исполнительные документы прямо из поля: ведомость по пикетам (CSV для Excel), схема в плане (DXF для AutoCAD)
 * и отправка за день одной кнопкой — ботом в Telegram или через «Поделиться».
 */

const CRLF = String.fromCharCode(13, 10);
const BOM = String.fromCharCode(0xfeff);
/** Excel с русскими настройками: разделитель «;», дробная часть через запятую. */
const n = (v: number | null | undefined, d: number) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d).replace('.', ','));

export function vedomostCsv(project: Project, rows: Row[], seq: string[], set: RoadSettings, volCodes: string[]): string {
  const out: string[] = [];
  out.push(`Ведомость по пикетам;${project.name}`);
  out.push(`Допуск по высоте ±${set.tolH} мм;уклон ±${set.tolSlope} ‰;сформировано ${new Date().toLocaleString('ru-RU')}`);
  out.push('');
  out.push('№;Точка;Код;Этап;ПК;Смещение, м;N;E;H факт;H проект;Δ, мм;В допуске;Толщина, мм;σ план;Решение;Дата');
  rows.forEach((r, k) => {
    const p = r.p;
    out.push([
      k + 1, p.name, p.code, p.stage ?? '', r.st ? fmtPk(r.st.s) : '', n(r.st?.off, 2),
      n(p.north, 3), n(p.east, 3), n(p.height, 3), n(r.hd, 3), n(r.dh, 0),
      r.ok == null ? '' : r.ok ? 'да' : 'НЕТ', n(r.thick, 0), n(p.hAccuracy, 3), p.quality.toUpperCase(),
      new Date(p.createdAt).toLocaleString('ru-RU'),
    ].join(';'));
  });
  const sl = slopes(sections(rows, set.secTol), seq, set.tolSlope);
  if (sl.length) {
    out.push('', `Поперечные уклоны (${seq.slice(0, 3).join(' – ')}), ‰`);
    out.push('ПК;Слева факт;Слева проект;Слева в допуске;Справа факт;Справа проект;Справа в допуске');
    for (const s of sl) {
      const side = (x: typeof s.left) => x ? [n(x.fact, 1), n(x.design, 1), x.ok == null ? '' : x.ok ? 'да' : 'НЕТ'] : ['', '', ''];
      out.push([fmtPk(s.s), ...side(s.left), ...side(s.right)].join(';'));
    }
  }
  if (rows.some((r) => isBefore(r.p))) {
    const v = volumes(rows, volCodes, set);
    if (v.rows.length) {
      out.push('', `Объёмы по съёмкам «до» и «после» (${volCodes.join(', ')})`);
      out.push('ПК;Отсыпка слева, м²;Срезка слева, м²;Отсыпка справа, м²;Срезка справа, м²;Отсыпка, м³;Срезка, м³');
      for (const r of v.rows) out.push([fmtPk(r.s), n(r.fillL, 2), n(r.cutL, 2), n(r.fillR, 2), n(r.cutR, 2), n(r.vFill, 2), n(r.vCut, 2)].join(';'));
      out.push(['Итого', '', '', '', '', n(v.fill, 2), n(v.cut, 2)].join(';'));
    }
  }
  return BOM + out.join(CRLF) + CRLF;
}

// ---------- DXF ----------

/** Кириллица в DXF R12 — через \U+XXXX: файл ASCII, AutoCAD читает при любой кодовой странице. */
const dxfText = (s: string) => s.replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
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
 * Исполнительная схема в плане, местные координаты (x = E, y = N): ось и проектные линии на участке съёмки,
 * пикеты, точки с подписями «имя / H факт / Δ мм» (зелёным в допуске, красным вне), уклоны на поперечниках.
 */
export function schemeDxf(project: Project, road: Road, rows: Row[], codes: FeatureCode[], seq: string[], set: RoadSettings): string {
  const e: string[] = [];
  const put = (...kv: Array<string | number>) => { for (let i = 0; i < kv.length; i += 2) e.push(String(kv[i]), String(kv[i + 1])); };
  const fx = (v: number) => v.toFixed(3);
  const line = (layer: string, color: number, pts: Array<[number, number]>) => {
    if (pts.length < 2) return;
    put(0, 'POLYLINE', 8, layer, 62, color, 66, 1, 70, 0);
    for (const [x, y] of pts) put(0, 'VERTEX', 8, layer, 10, fx(x), 20, fx(y), 30, 0);
    put(0, 'SEQEND', 8, layer);
  };
  const text = (layer: string, color: number, x: number, y: number, h: number, s: string, rot = 0) =>
    put(0, 'TEXT', 8, layer, 62, color, 10, fx(x), 20, fx(y), 30, 0, 40, h, 1, dxfText(s), 50, rot.toFixed(2));

  const placed = rows.filter((r) => r.st && r.p.north != null && r.p.east != null);
  if (!placed.length) throw new Error('Нет точек с местными координатами на трассе');
  const s0 = Math.min(...placed.map((r) => r.st!.s)) - 40;
  const s1 = Math.max(...placed.map((r) => r.st!.s)) + 40;

  // ось и проектные линии на участке
  const idx = road.pk.map((_, k) => k).filter((k) => road.pk[k] >= s0 && road.pk[k] <= s1);
  const at = (k: number, off: number): [number, number] => {
    const a = Math.min(k, road.pk.length - 2);
    const dN = road.n[a + 1] - road.n[a]; const dE = road.e[a + 1] - road.e[a]; const L = Math.hypot(dN, dE) || 1;
    return [road.e[k] + (off * dN) / L, road.n[k] - (off * dE) / L];
  };
  line('OS', 1, idx.map((k) => [road.e[k], road.n[k]]));
  for (const [key, layer] of [['KL', 'KROMKA'], ['KR', 'KROMKA'], ['BL', 'BROVKA'], ['BR', 'BROVKA']] as const) {
    const l = road.lines[key];
    if (!l) continue;
    line(layer, layer === 'KROMKA' ? 8 : 9, idx.filter((k) => Number.isFinite(l.off[k])).map((k) => at(k, l.off[k])));
  }

  // пикеты: штрих через каждые pkStep, подпись на сотнях
  const step = set.pkStep;
  for (let s = Math.ceil(s0 / step) * step; s <= s1; s += step) {
    const k = road.pk.findIndex((v) => v >= s);
    if (k <= 0) continue;
    const t = (s - road.pk[k - 1]) / ((road.pk[k] - road.pk[k - 1]) || 1);
    const E = road.e[k - 1] + t * (road.e[k] - road.e[k - 1]); const N = road.n[k - 1] + t * (road.n[k] - road.n[k - 1]);
    const dN = road.n[k] - road.n[k - 1]; const dE = road.e[k] - road.e[k - 1]; const L = Math.hypot(dN, dE) || 1;
    const big = Math.abs(s / 100 - Math.round(s / 100)) < 1e-6;
    const half = big ? 1.5 : 0.75;
    line('PIKET', 7, [[E - (half * dN) / L, N + (half * dE) / L], [E + (half * dN) / L, N - (half * dE) / L]]);
    if (big) {
      const ang = (Math.atan2(-dE, dN) * 180) / Math.PI; // поперёк оси
      text('PIKET', 7, E + (2 * dN) / L, N - (2 * dE) / L, 0.8, `ПК ${Math.round(s / 100)}`, ang);
    }
  }

  // точки
  const H = 0.35;
  for (const r of placed) {
    const p = r.p;
    const layer = layerName(p.code || 'POINTS') + (isBefore(p) ? '_DO' : '');
    const c = isBefore(p) ? 8 : aciOf(codes.find((x) => x.code === p.code)?.color);
    const x = p.east!; const y = p.north!;
    put(0, 'POINT', 8, layer, 62, c, 10, fx(x), 20, fx(y), 30, fx(p.height ?? 0));
    put(0, 'CIRCLE', 8, layer, 62, c, 10, fx(x), 20, fx(y), 30, 0, 40, 0.15);
    text(layer, 7, x + 0.25, y + 0.1, H, p.name);
    text(layer, 7, x + 0.25, y - 0.1 - H, H, (p.height ?? p.elevation).toFixed(3));
    if (r.dh != null) {
      text(layer, r.ok ? 3 : 1, x + 0.25, y - 0.3 - 2 * H, H, `${r.dh >= 0 ? '+' : ''}${r.dh.toFixed(0)}`);
    }
    if (r.thick != null) text(layer, 4, x + 0.25, y - 0.5 - 3 * H, H, `h=${r.thick.toFixed(0)}`);
  }

  // уклоны: над серединой поперечника
  for (const sl of slopes(sections(rows, set.secTol), seq, set.tolSlope)) {
    const k = road.pk.findIndex((v) => v >= sl.s);
    if (k <= 0) continue;
    const [x, y] = at(k, 0);
    const t = [sl.left && `${sl.left.fact.toFixed(0)}‰`, sl.right && `${sl.right.fact.toFixed(0)}‰`].filter(Boolean).join(' | ');
    const bad = sl.left?.ok === false || sl.right?.ok === false;
    text('UKLON', bad ? 1 : 3, x + 0.3, y + 0.9, H, t);
  }

  const head = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$DWGCODEPAGE', '3', 'ANSI_1251',
    '9', '$INSUNITS', '70', '6', '0', 'ENDSEC'];
  return [...head, '0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join(CRLF) + CRLF;
}

// ---------- Telegram и «за сегодня» ----------

export interface TgConfig { token: string; chat: string }

export async function loadTg(): Promise<TgConfig | null> {
  const [token, chat] = await Promise.all([kvGet('tgToken'), kvGet('tgChat')]);
  return token && chat ? { token: token.trim(), chat: chat.trim() } : null;
}

export async function sendTelegram(cfg: TgConfig, file: File, name: string, mime: string, caption: string) {
  const fd = new FormData();
  fd.append('chat_id', cfg.chat);
  fd.append('caption', caption.slice(0, 1000));
  fd.append('document', { uri: file.uri, name, type: mime } as unknown as Blob);
  const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendDocument`, { method: 'POST', body: fd });
  const j = await res.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !j?.ok) throw new Error(`Telegram: ${j?.description ?? res.status}`);
}

/** Начало дня по часам телефона. */
export function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Точки за день — каталог NEH, ведомость и (если есть трасса) схема DXF. Есть бот — уходят в Telegram,
 * нет — по очереди через «Поделиться». Возвращает, что отправлено.
 */
export async function sendDay(project: Project, all: SurveyPoint[], road: Road | null, codes: FeatureCode[],
  seq: string[], set: RoadSettings, volCodes: string[], since = todayStart()): Promise<string> {
  const day = all.filter((p) => p.createdAt >= since);
  if (!day.length) throw new Error('За сегодня точек нет');
  const date = new Date(since).toLocaleDateString('ru-RU').replace(/\./g, '-');
  const base = `${sanitizeName(project.name)}_${date}`;
  const files: Array<{ file: File; name: string; mime: string }> = [];
  const neh = localTxt(day);
  if (neh.count) files.push({ file: writeCacheFile(`${base}_NEH.txt`, neh.text), name: `${base}_NEH.txt`, mime: 'text/plain' });
  if (road) {
    // толщина и объёмы за день считаются по всей съёмке «до», не только сегодняшней
    const before = all.filter((p) => isBefore(p) && p.createdAt < since);
    const rowsAll = analyse(road, [...day, ...before], set);
    const rows = rowsAll.filter((r) => r.p.createdAt >= since);
    files.push({ file: writeCacheFile(`${base}_ведомость.csv`, vedomostCsv(project, rowsAll, seq, set, volCodes)), name: `${base}_ведомость.csv`, mime: 'text/csv' });
    try {
      files.push({ file: writeCacheFile(`${base}_схема.dxf`, schemeDxf(project, road, rows, codes, seq, set)), name: `${base}_схема.dxf`, mime: 'application/dxf' });
    } catch { /* без местных координат схемы нет */ }
  }
  if (!files.length) throw new Error('Нет точек с местными координатами — сначала калибровка');
  const tg = await loadTg();
  const caption = `${project.name}: ${day.length} точек за ${date}`;
  if (tg) {
    for (const f of files) await sendTelegram(tg, f.file, f.name, f.mime, caption);
    return `В Telegram: ${files.map((f) => f.name).join(', ')}`;
  }
  for (const f of files) await shareFile(f.file, f.mime, f.name);
  return `Через «Поделиться»: ${files.length} файла`;
}
