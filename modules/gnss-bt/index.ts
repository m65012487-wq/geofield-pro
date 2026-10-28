import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export interface BondedDevice { name: string; address: string }
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
  addListener(event: 'onLine', cb: (e: { line: string }) => void): EventSubscription;
  addListener(event: 'onState', cb: (e: { state: BtState; message: string }) => void): EventSubscription;
}

/** null в Expo Go и в вебе — там приёмника нет, работает только GPS телефона. */
export const GnssBt = requireOptionalNativeModule<GnssBtNative>('GnssBt');
