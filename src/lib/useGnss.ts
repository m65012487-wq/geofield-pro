import { useEffect, useRef, useState, useCallback } from 'react';
import * as Location from 'expo-location';
import type { FixQuality, LivePosition } from '../db/types';

/**
 * Преобразует горизонтальную точность GPS в класс качества решения.
 * В реальном RTK это приходит от приёмника; здесь — эвристика по точности
 * телефонного GPS, чтобы продемонстрировать индикацию Fix/Float/Single.
 */
function classifyQuality(hAccuracy: number | null): FixQuality {
  if (hAccuracy == null) return 'none';
  if (hAccuracy <= 1.5) return 'fix';     // имитация RTK Fixed
  if (hAccuracy <= 5) return 'float';     // имитация Float
  return 'single';                         // Autonomous
}

export type GnssStatus = 'idle' | 'requesting' | 'denied' | 'active' | 'error';

export function useGnss() {
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [status, setStatus] = useState<GnssStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const subRef = useRef<Location.LocationSubscription | null>(null);

  const start = useCallback(async () => {
    try {
      setStatus('requesting');
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        setStatus('denied');
        setErrorMsg('Доступ к геолокации не предоставлен.');
        return;
      }
      setStatus('active');
      setErrorMsg(null);

      subRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (loc) => {
          const h = loc.coords.accuracy ?? null;
          setPosition({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            elevation: loc.coords.altitude ?? 0,
            hAccuracy: h ?? 0,
            vAccuracy: loc.coords.altitudeAccuracy ?? 0,
            quality: classifyQuality(h),
            satellites: null, // телефон не отдаёт число спутников через JS API
            timestamp: loc.timestamp,
          });
        }
      );
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : 'Ошибка GPS');
    }
  }, []);

  const stop = useCallback(() => {
    subRef.current?.remove();
    subRef.current = null;
  }, []);

  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  return { position, status, errorMsg, start, stop };
}
