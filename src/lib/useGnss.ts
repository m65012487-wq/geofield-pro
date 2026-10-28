import { useEffect, useState } from 'react';
import { getGnss, startGnss, subscribeGnss, type GnssState } from './gnss';

/** Текущая позиция и состояние приёмника (общие на всё приложение, см. gnss.ts). */
export function useGnss(): GnssState & { errorMsg: string | null; start: () => void } {
  const [s, setS] = useState<GnssState>(getGnss());
  useEffect(() => {
    startGnss();
    return subscribeGnss(setS);
  }, []);
  return {
    ...s,
    errorMsg: s.status === 'error' || s.status === 'denied' ? s.message : null,
    start: () => { startGnss(); },
  };
}
