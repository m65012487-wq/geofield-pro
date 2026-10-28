import { useEffect, useState } from 'react';
import { kvGet, kvSet } from '../db/database';
import { solveCalibration, toLocal, type CalibPair, type Calibration } from './calib';

/** Калибровка проекта: пары «репер — измерение» и решённые параметры. Хранится в kv как JSON. */
export interface ProjectCalib {
  pairs: CalibPair[];
  cal: Calibration | null;
}

const cache = new Map<string, ProjectCalib>();
const listeners = new Set<(pid: string) => void>();
const key = (pid: string) => `calib:${pid}`;

export async function loadCalib(pid: string): Promise<ProjectCalib> {
  const hit = cache.get(pid);
  if (hit) return hit;
  const raw = await kvGet(key(pid));
  let v: ProjectCalib = { pairs: [], cal: null };
  if (raw) {
    try { v = JSON.parse(raw) as ProjectCalib; } catch { /* битая запись — начинаем заново */ }
  }
  cache.set(pid, v);
  return v;
}

/** Сохраняет пары и пересчитывает параметры (cal = null, если пунктов не хватает). */
export async function saveCalib(pid: string, pairs: CalibPair[]): Promise<ProjectCalib> {
  let cal: Calibration | null = null;
  if (pairs.filter((p) => p.useHz).length >= 2) cal = solveCalibration(pairs);
  const v: ProjectCalib = { pairs, cal };
  cache.set(pid, v);
  await kvSet(key(pid), JSON.stringify(v));
  listeners.forEach((l) => l(pid));
  return v;
}

export function useCalibration(pid: string | undefined): ProjectCalib | null {
  const [v, setV] = useState<ProjectCalib | null>(pid ? cache.get(pid) ?? null : null);
  useEffect(() => {
    if (!pid) { setV(null); return; }
    let alive = true;
    loadCalib(pid).then((x) => alive && setV(x));
    const l = (changed: string) => { if (changed === pid) loadCalib(pid).then((x) => alive && setV(x)); };
    listeners.add(l);
    return () => { alive = false; listeners.delete(l); };
  }, [pid]);
  return v;
}

/** Местные N/E/H для позиции, если проект откалиброван. h — высота земли (веха уже вычтена). */
export function localOf(c: ProjectCalib | null, lat: number, lon: number, h: number) {
  return c?.cal ? toLocal(c.cal, lat, lon, h) : null;
}
