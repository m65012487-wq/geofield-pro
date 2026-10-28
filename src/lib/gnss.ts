import * as Location from 'expo-location';
import { GnssBt, type BondedDevice } from '../../modules/gnss-bt';
import { NmeaParser } from './nmea';
import { kvGet, kvSet } from '../db/database';
import type { FixQuality, LivePosition } from '../db/types';

/**
 * Единый источник позиции на всё приложение: внешний приёмник по Bluetooth (NMEA)
 * или, если приёмника нет, GPS телефона. Соединение живёт вне экранов — переход
 * между вкладками его не рвёт.
 */
export type GnssSource = 'receiver' | 'phone';
export type GnssStatus = 'idle' | 'connecting' | 'active' | 'denied' | 'error';

export interface GnssState {
  source: GnssSource;
  status: GnssStatus;
  message: string;
  deviceName: string | null;
  position: LivePosition | null;
  /** Последние строки NMEA — для экрана диагностики. */
  rawTail: string[];
}

type Listener = (s: GnssState) => void;

const STALE_MS = 3000;

let state: GnssState = {
  source: 'receiver', status: 'idle', message: '', deviceName: null, position: null, rawTail: [],
};
const listeners = new Set<Listener>();
const parser = new NmeaParser();
let started = false;
let phoneSub: Location.LocationSubscription | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;

function set(patch: Partial<GnssState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function getGnss(): GnssState { return state; }

export function subscribeGnss(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

export const receiverAvailable = GnssBt != null;

function phoneQuality(acc: number | null): FixQuality {
  if (acc == null) return 'none';
  return 'single'; // телефон FIX не даёт, сколько бы ни показывал точность
}

function onLine(line: string) {
  const tail = state.rawTail.length >= 40 ? state.rawTail.slice(-39) : state.rawTail.slice();
  tail.push(line);
  const e = parser.feed(line);
  if (!e) { state = { ...state, rawTail: tail }; return; }
  const sigH = e.sigmaN != null && e.sigmaE != null ? Math.max(e.sigmaN, e.sigmaE) : null;
  set({
    rawTail: tail,
    status: 'active',
    position: {
      latitude: e.latitude,
      longitude: e.longitude,
      elevation: e.altitude,
      // без GST точность оцениваем грубо через HDOP — только для порога, не для отчёта
      hAccuracy: sigH ?? e.hdop * (e.quality === 'fix' ? 0.01 : e.quality === 'float' ? 0.3 : 3),
      vAccuracy: e.sigmaH ?? e.hdop * (e.quality === 'fix' ? 0.02 : e.quality === 'float' ? 0.5 : 5),
      quality: e.quality,
      satellites: e.satellites,
      timestamp: Date.now(),
      hdop: e.hdop,
      diffAge: e.diffAge,
      geoidSep: e.geoidSep,
      hasSigma: sigH != null,
    },
  });
}

/** Один раз за жизнь приложения: подписки на модуль и автоподключение к последнему приёмнику. */
export async function startGnss(): Promise<void> {
  if (started) return;
  started = true;
  staleTimer = setInterval(() => {
    const p = state.position;
    if (p && state.source === 'receiver' && Date.now() - p.timestamp > STALE_MS && p.quality !== 'none') {
      set({ position: { ...p, quality: 'none' }, message: 'Нет данных от приёмника' });
    }
  }, 1000);
  const src = (await kvGet('gnssSource')) as GnssSource | null;
  if (!GnssBt || src === 'phone') { await switchToPhone(); return; }
  GnssBt.addListener('onLine', ({ line }) => onLine(line));
  GnssBt.addListener('onState', ({ state: st, message }) => {
    if (st === 'connected') set({ status: 'active', message: 'Подключено', deviceName: message });
    else if (st === 'connecting') set({ status: 'connecting', message });
    else set({ status: st === 'error' ? 'error' : 'idle', message });
  });
  set({ source: 'receiver' });
  const addr = await kvGet('btDevice');
  if (addr) connectReceiver(addr).catch(() => {});
  else set({ message: 'Приёмник не выбран' });
}

export function bondedDevices(): BondedDevice[] {
  return GnssBt?.bondedDevices() ?? [];
}

export async function ensureBtPermission(): Promise<boolean> {
  if (!GnssBt) return false;
  if (GnssBt.hasPermission()) return true;
  await GnssBt.requestPermission();
  return GnssBt.hasPermission();
}

export async function connectReceiver(address: string): Promise<void> {
  if (!GnssBt) throw new Error('Приёмник доступен только в установленном приложении');
  stopPhone();
  await kvSet('btDevice', address);
  await kvSet('gnssSource', 'receiver');
  set({ source: 'receiver', status: 'connecting', position: null });
  await GnssBt.connect(address);
}

export function disconnectReceiver() {
  GnssBt?.disconnect();
  set({ status: 'idle', position: null });
}

export async function sendToReceiver(text: string) {
  await GnssBt?.write(text);
}

function stopPhone() {
  phoneSub?.remove();
  phoneSub = null;
}

export async function switchToPhone(): Promise<void> {
  GnssBt?.disconnect();
  await kvSet('gnssSource', 'phone');
  set({ source: 'phone', status: 'connecting', deviceName: 'GPS телефона', position: null });
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') { set({ status: 'denied', message: 'Нет доступа к геолокации' }); return; }
  stopPhone();
  phoneSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
    (loc) => set({
      status: 'active',
      position: {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        elevation: loc.coords.altitude ?? 0,
        hAccuracy: loc.coords.accuracy ?? 0,
        vAccuracy: loc.coords.altitudeAccuracy ?? 0,
        quality: phoneQuality(loc.coords.accuracy ?? null),
        satellites: null,
        timestamp: loc.timestamp,
        hdop: null, diffAge: null, geoidSep: null, hasSigma: false,
      },
    }),
  );
}
