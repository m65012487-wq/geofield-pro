import { Platform } from 'react-native';
import { GnssBt, type NtripEvent, type NtripMount } from '../../modules/gnss-bt';
import { kvGet, kvSet } from '../db/database';

/**
 * NTRIP-клиент: поправки RTK из сети базовых станций через интернет телефона идут в приёмник по Bluetooth.
 * Работает в нативном модуле (только Android); здесь — настройки, запуск/остановка и состояние для экрана.
 */
export type { NtripEvent, NtripMount };

export interface NtripSettings { host: string; port: string; mount: string; user: string; pass: string }

export const DEFAULT_NTRIP_PORT = '2101';

export const ntripAvailable =
  Platform.OS === 'android' && GnssBt != null && typeof GnssBt.ntripStart === 'function';

export async function loadNtripSettings(): Promise<NtripSettings> {
  const [host, port, mount, user, pass] = await Promise.all(
    ['ntripHost', 'ntripPort', 'ntripMount', 'ntripUser', 'ntripPass'].map((k) => kvGet(k)),
  );
  return { host: host ?? '', port: port || DEFAULT_NTRIP_PORT, mount: mount ?? '', user: user ?? '', pass: pass ?? '' };
}

export async function saveNtripSettings(s: NtripSettings): Promise<void> {
  await Promise.all([
    kvSet('ntripHost', s.host.trim()),
    kvSet('ntripPort', s.port.trim() || DEFAULT_NTRIP_PORT),
    kvSet('ntripMount', s.mount.trim()),
    kvSet('ntripUser', s.user.trim()),
    kvSet('ntripPass', s.pass),
  ]);
}

function parsePort(p: string): number {
  const n = parseInt(p, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) throw new Error('Порт — число от 1 до 65535');
  return n;
}

const IDLE: NtripEvent = { state: 'stopped', message: '', bytes: 0, rate: 0, lastMs: -1 };
let current: NtripEvent = IDLE;
const listeners = new Set<(e: NtripEvent) => void>();
let hooked = false;

function hook() {
  if (hooked || !ntripAvailable) return;
  hooked = true;
  GnssBt!.addListener('onNtrip', (e) => {
    current = e;
    listeners.forEach((l) => l(e));
  });
}

export function getNtrip(): NtripEvent { return current; }

export function subscribeNtrip(l: (e: NtripEvent) => void): () => void {
  hook();
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Подключиться к точке; настройки заодно сохраняются. */
export async function startNtrip(s: NtripSettings): Promise<void> {
  if (!ntripAvailable) throw new Error('NTRIP работает только на Android');
  if (!s.host.trim()) throw new Error('Введите адрес сервера');
  if (!s.mount.trim()) throw new Error('Введите точку подключения (mountpoint)');
  const port = parsePort(s.port);
  hook();
  await saveNtripSettings(s);
  GnssBt!.ntripStart!(s.host.trim(), port, s.mount.trim(), s.user.trim(), s.pass);
}

export function stopNtrip(): void {
  if (ntripAvailable) GnssBt!.ntripStop?.();
}

/** Список точек подключения сервера (GET / — таблица источников). */
export async function ntripSourcetable(s: Pick<NtripSettings, 'host' | 'port' | 'user' | 'pass'>): Promise<NtripMount[]> {
  if (!ntripAvailable || typeof GnssBt!.ntripSourcetable !== 'function') throw new Error('NTRIP работает только на Android');
  if (!s.host.trim()) throw new Error('Введите адрес сервера');
  const list = await GnssBt!.ntripSourcetable(s.host.trim(), parsePort(s.port), s.user.trim(), s.pass);
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}
