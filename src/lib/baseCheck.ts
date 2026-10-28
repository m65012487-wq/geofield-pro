import { kvGet, kvSet } from '../db/database';

/** Контроль на репере: результаты проверок хранятся в kv `basecheck:<pid>` JSON-массивом. */
export interface BaseCheck {
  ts: number;
  name: string;
  dN: number;
  dE: number;
  dH: number;
  ok: boolean;
  epochs: number;
}

const key = (pid: string) => `basecheck:${pid}`;

export async function listBaseChecks(pid: string): Promise<BaseCheck[]> {
  const raw = await kvGet(key(pid));
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as BaseCheck[]) : [];
  } catch {
    return [];
  }
}

export async function addBaseCheck(pid: string, c: BaseCheck): Promise<void> {
  const all = await listBaseChecks(pid);
  all.push(c);
  await kvSet(key(pid), JSON.stringify(all.slice(-200)));
}

export const sameLocalDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** Последняя проверка за сегодня (локальная дата) или null — для журнала. */
export async function lastBaseCheckToday(pid: string): Promise<BaseCheck | null> {
  const now = Date.now();
  const today = (await listBaseChecks(pid)).filter((c) => sameLocalDay(c.ts, now));
  return today.length ? today.reduce((a, b) => (b.ts > a.ts ? b : a)) : null;
}
