import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import type { EventSubscription } from 'expo-modules-core';
import { HwKeys } from '../../modules/gnss-bt';
import { kvGet } from '../db/database';

/**
 * «Громкость −» снимает точку, пока экран открыт (Android). Выключается в настройках (kv volumeShutter = '0').
 * Обработчик берётся свежий на каждое нажатие — замыкание с устаревшим состоянием не страшно.
 */
export function useShutter(handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useFocusEffect(useCallback(() => {
    if (!HwKeys) return;
    let alive = true;
    let sub: EventSubscription | null = null;
    kvGet('volumeShutter').then((v) => {
      if (!alive || v === '0') return;
      sub = HwKeys!.addListener('onKey', () => ref.current());
      HwKeys!.setEnabled(true);
    });
    return () => {
      alive = false;
      sub?.remove();
      HwKeys!.setEnabled(false);
    };
  }, []));
}
