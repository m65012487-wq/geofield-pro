import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';

const JOLT = 0.15;   // g — толчок шага: веху несут, автоспуск взводится
const CALM = 0.03;   // g — веха стоит (дрожь рук меньше этого)
const HOLD_MS = 1500; // столько стоять, чтобы сработало

/**
 * Автоспуск по неподвижности: телефон на вехе. Понесли веху (толчки) — взвелось;
 * поставили и держат ровно полторы секунды — onStill один раз, до следующего переноса.
 */
export function useStillness(enabled: boolean, onStill: () => void) {
  const cb = useRef(onStill);
  cb.current = onStill;

  useEffect(() => {
    if (!enabled) return;
    let armed = false;
    let calmSince = 0;
    let ema = 1;
    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const m = Math.sqrt(x * x + y * y + z * z);
      const dev = Math.abs(m - ema);
      ema = ema * 0.8 + m * 0.2;
      const now = Date.now();
      if (dev > JOLT) { armed = true; calmSince = 0; return; }
      if (dev > CALM) { calmSince = 0; return; }
      if (!calmSince) calmSince = now;
      if (armed && now - calmSince > HOLD_MS) { armed = false; cb.current(); }
    });
    return () => sub.remove();
  }, [enabled]);
}
