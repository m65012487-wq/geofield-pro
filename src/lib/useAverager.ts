import { useEffect, useRef, useState } from 'react';
import type { LivePosition } from '../db/types';

/** Копит эпохи из живого потока до n штук (только FIX, если не разрешено иное) и отдаёт среднее. */
export function useAverager(position: LivePosition | null, n: number, onDone: (mean: LivePosition, count: number) => void) {
  const [active, setActive] = useState<{ any: boolean } | null>(null);
  const [samples, setSamples] = useState<LivePosition[]>([]);
  const lastTs = useRef(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!active || !position || position.timestamp === lastTs.current) return;
    lastTs.current = position.timestamp;
    if (!active.any && position.quality !== 'fix') { setSamples([]); return; }
    setSamples((s) => [...s, position]);
  }, [position, active]);

  useEffect(() => {
    if (!active || samples.length < n) return;
    const k = samples.length;
    const mean = (f: (p: LivePosition) => number) => samples.reduce((a, p) => a + f(p), 0) / k;
    const res: LivePosition = {
      latitude: mean((p) => p.latitude),
      longitude: mean((p) => p.longitude),
      elevation: mean((p) => p.elevation),
      hAccuracy: Math.max(...samples.map((p) => p.hAccuracy)),
      vAccuracy: Math.max(...samples.map((p) => p.vAccuracy)),
      quality: samples.every((p) => p.quality === 'fix') ? 'fix' : samples[samples.length - 1].quality,
      satellites: Math.min(...samples.map((p) => p.satellites ?? 0)),
      timestamp: Date.now(),
    };
    setActive(null);
    setSamples([]);
    done.current(res, k);
  }, [samples, active, n]);

  return {
    running: active != null,
    count: samples.length,
    start: (any = false) => { lastTs.current = position?.timestamp ?? 0; setSamples([]); setActive({ any }); },
    cancel: () => { setActive(null); setSamples([]); },
  };
}
