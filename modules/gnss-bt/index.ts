import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export interface BondedDevice { name: string; address: string }
export type NtripState = 'connecting' | 'connected' | 'error' | 'stopped';
export interface NtripEvent { state: NtripState; message: string; bytes: number; rate: number; lastMs: number }
export interface NtripMount { name: string; identifier?: string; format: string; lat?: number; lon?: number }
export type BtState = 'connecting' | 'connected' | 'disconnected' | 'error';

interface GnssBtNative {
  isEnabled(): boolean;
  hasPermission(): boolean;
  requestPermission(): Promise<boolean>;
  bondedDevices(): BondedDevice[];
  isConnected(): boolean;
  connect(address: string): Promise<boolean>;
  disconnect(): void;
  write(text: string): Promise<void>;
  // NTRIP — только Android; на iOS этих функций нет, проверять typeof fn === 'function'
  ntripStart?(host: string, port: number, mount: string, user: string, pass: string): void;
  ntripStop?(): void;
  ntripSourcetable?(host: string, port: number, user: string, pass: string): Promise<NtripMount[]>;
  addListener(event: 'onNtrip', cb: (e: NtripEvent) => void): EventSubscription;
  addListener(event: 'onLine', cb: (e: { line: string }) => void): EventSubscription;
  addListener(event: 'onState', cb: (e: { state: BtState; message: string }) => void): EventSubscription;
  addListener(event: 'onStats', cb: (e: { bytes: number; hex: string }) => void): EventSubscription;
}

/** null в Expo Go и в вебе — там приёмника нет, работает только GPS телефона. */
export const GnssBt = requireOptionalNativeModule<GnssBtNative>('GnssBt');

interface HwKeysNative {
  setEnabled(on: boolean): void;
  addListener(event: 'onKey', cb: (e: { key: string }) => void): EventSubscription;
}

/** Клавиша «громкость −» как спуск съёмки. Только Android; на iOS и в Expo Go — null. */
export const HwKeys = requireOptionalNativeModule<HwKeysNative>('HwKeys');
