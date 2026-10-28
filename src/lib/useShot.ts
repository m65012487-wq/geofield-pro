import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { addPoint, kvGet, kvSet, listPoints, nextNameForCode } from '../db/database';
import type { FeatureCode, FixQuality, LivePosition } from '../db/types';
import { localOf, type ProjectCalib } from './calibStore';
import { beep, say, spokenName } from './feedback';
import { useStillness } from './useStillness';
import { loadRoad, roadCached } from './road';
import { analyse, loadRoadSettings, rowSummary, slopeAfterShot, type RoadSettings } from './roadCheck';

export const STAGES = ['', 'до', 'после'] as const;

/** Что сказать об отклонении: «выше на 12 миллиметров». */
function spokenDh(dh: number, ok: boolean | null) {
  const v = Math.round(Math.abs(dh));
  const t = v === 0 ? 'в проекте' : `${dh > 0 ? 'выше' : 'ниже'} на ${v} мм`;
  return ok === false ? `${t}, вне допуска` : t;
}

const QUALITY_RANK: Record<FixQuality, number> = { fix: 3, float: 2, single: 1, none: 0 };

/** Эпох по умолчанию для объектов: дорога и обочины — одна эпоха FIX, съезды — три. */
export const DEFAULT_CODE_EPOCHS: Record<string, number> = { DOR: 1, OBL: 1, OBP: 1, SEZ: 3 };
export const DEFAULT_SEQ = 'OBL,DOR,OBP';

export interface ShotSettings {
  epochs: number;
  accLimit: number;
  codeEpochs: Record<string, number>;
  waitFix: boolean;
  voice: boolean;
  seq: string[];
  autoStep: number;
}

export async function loadShotSettings(): Promise<ShotSettings> {
  const [ep, acc, ce, wf, vo, sq, st] = await Promise.all(
    ['avgEpochs', 'accLimit', 'codeEpochs', 'waitFix', 'voice', 'shotSeq', 'autoStep'].map(kvGet));
  let codeEpochs = DEFAULT_CODE_EPOCHS;
  if (ce) try { codeEpochs = JSON.parse(ce); } catch { /* по умолчанию */ }
  return {
    epochs: parseInt(ep ?? '2', 10) || 2,
    accLimit: parseFloat(acc ?? '0.05') || 0.05,
    codeEpochs,
    waitFix: wf !== '0',
    voice: vo !== '0',
    seq: (sq ?? DEFAULT_SEQ).split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
    autoStep: parseFloat(st ?? '5') || 5,
  };
}

export function epochsFor(s: ShotSettings, code: string | null) {
  return Math.max(1, (code && s.codeEpochs[code]) || s.epochs);
}

interface Cfg {
  projectId: string | undefined;
  calib: ProjectCalib | null;
  pole: number;
  codes: FeatureCode[];
  onSaved: () => void;
  /** Снято без кода — экран сам спрашивает имя. */
  onManual?: (mean: LivePosition, epochs: number) => void;
}

/**
 * Съёмка точки, общая для «Съёмки» и «Карты»: эпохи по объекту, ожидание FIX без вопросов,
 * звук и голос, поперечник (объект сам переключается по порядку), автосъёмка через N метров
 * и автоспуск по неподвижности телефона на вехе.
 */
export function useShot(position: LivePosition | null, cfg: Cfg) {
  const [settings, setSettings] = useState<ShotSettings | null>(null);
  const [cur, setCurState] = useState<string | null>(null);
  const [seqOn, setSeqOn] = useState(false);
  const [autoOn, setAutoOn] = useState(false);
  const [stillOn, setStillOn] = useState(false);
  const [shot, setShot] = useState<{ code: string | null; need: number; any: boolean } | null>(null);
  const [stage, setStageState] = useState('');
  const [roadSet, setRoadSet] = useState<RoadSettings | null>(null);
  /** Итог последней точки по трассе: пикет, смещение, отклонение, уклоны. */
  const [lastInfo, setLastInfo] = useState<{ name: string; text: string; bad: boolean } | null>(null);
  const [samples, setSamples] = useState<LivePosition[]>([]);
  const lastTs = useRef(0);
  const lastAuto = useRef<{ x: number; y: number } | null>(null);
  const busy = useRef(false);

  // свежие значения для обработчиков событий (клавиша, датчик, таймеры)
  const live = useRef({ position, cfg, settings, cur, seqOn, shot, stage, roadSet });
  live.current = { position, cfg, settings, cur, seqOn, shot, stage, roadSet };

  useFocusEffect(useCallback(() => {
    loadShotSettings().then(setSettings);
    kvGet('mapCode').then((v) => v && setCurState(v));
    kvGet('shotSeqOn').then((v) => setSeqOn(v === '1'));
    loadRoadSettings().then(setRoadSet);
    if (cfg.projectId) {
      loadRoad(cfg.projectId);
      kvGet(`stage:${cfg.projectId}`).then((v) => setStageState(v ?? ''));
    }
    return () => { setAutoOn(false); setStillOn(false); };
  }, [cfg.projectId]));

  const setCur = (c: string) => { setCurState(c); kvSet('mapCode', c); };
  const desc = (code: string) => live.current.cfg.codes.find((c) => c.code === code)?.description || code;

  /** Плоские метры для шага автосъёмки: местные координаты, а без калибровки — от широты/долготы. */
  const planar = (p: LivePosition) => {
    const l = localOf(live.current.cfg.calib, p.latitude, p.longitude, p.elevation);
    if (l) return { x: l.east, y: l.north };
    const k = 111320;
    return { x: p.longitude * k * Math.cos((p.latitude * Math.PI) / 180), y: p.latitude * k };
  };

  const save = async (code: string, r: LivePosition, n: number, auto: boolean) => {
    const { cfg: c, settings: s, seqOn: sOn, stage: stg, roadSet: rs } = live.current;
    if (!c.projectId || !s) return;
    const write = async () => {
      busy.current = true;
      try {
        // имя берём из базы в момент записи — при автосъёмке точки идут чаще, чем обновляется экран
        const name = await nextNameForCode(c.projectId!, code);
        const loc = localOf(c.calib, r.latitude, r.longitude, r.elevation);
        await addPoint({
          projectId: c.projectId!, name, code,
          latitude: r.latitude, longitude: r.longitude, elevation: r.elevation,
          quality: r.quality, hAccuracy: r.hAccuracy, vAccuracy: r.vAccuracy,
          epochs: n, note: auto ? 'авто' : '', north: loc?.north ?? null, east: loc?.east ?? null, height: loc?.height ?? null,
          stage: stg,
        });
        lastAuto.current = planar(r);
        beep('done');
        let next = code;
        if (!auto && sOn && s.seq.length > 1) {
          const i = s.seq.indexOf(code);
          const cand = i >= 0 ? s.seq[(i + 1) % s.seq.length] : null;
          if (cand && c.codes.some((x) => x.code === cand)) next = cand;
        }
        if (next !== code) setCur(next);
        // пикет, отклонение от проекта и (на замыкании поперечника) уклоны
        let extra = '';
        const road = roadCached(c.projectId);
        if (road && rs && loc) {
          const rows = analyse(road, await listPoints(c.projectId!), rs);
          const me = rows.find((x) => x.p.name === name);
          if (me) {
            const sl = s.seq.length >= 3 && code === s.seq[2] ? slopeAfterShot(rows, name, s.seq, rs) : null;
            const slT = sl ? [sl.left, sl.right].map((x, k) => x ? `${k ? 'право' : 'лево'} ${x.fact.toFixed(0)}‰${x.design != null ? ` (пр. ${x.design.toFixed(0)})` : ''}${x.ok === false ? ' ✗' : ''}` : null).filter(Boolean).join(', ') : '';
            const bad = me.ok === false || !!(sl && (sl.left?.ok === false || sl.right?.ok === false));
            setLastInfo({ name, text: rowSummary(me) + (slT ? `
Уклоны: ${slT}` : ''), bad });
            if (bad) beep('bad');
            if (me.dh != null) extra = `. ${spokenDh(me.dh, me.ok)}`;
            if (sl) extra += `. Уклоны ${[sl.left, sl.right].map((x, k) => x ? `${k ? 'право' : 'лево'} ${Math.round(Math.abs(x.fact))}` : '').filter(Boolean).join(', ')} промилле`;
          }
        }
        if (s.voice && !auto) say(spokenName(name, code, desc(code)) + extra + (next !== code ? `. Дальше ${desc(next)}` : ''));
        c.onSaved();
      } finally {
        busy.current = false;
      }
    };
    if (r.hAccuracy > s.accLimit) {
      beep('bad');
      if (auto) return; // в автосъёмке плохую эпоху просто пропускаем
      if (s.voice) say('Точность хуже допуска');
      Alert.alert('Низкая точность', `σ план ${r.hAccuracy.toFixed(3)} м хуже допуска ${s.accLimit} м.`, [
        { text: 'Не сохранять', style: 'cancel' }, { text: 'Сохранить', onPress: write },
      ]);
      return;
    }
    await write();
  };

  const start = (code: string | null) => {
    const { position: p, settings: s } = live.current;
    if (!s) return;
    if (!p || p.quality === 'none') {
      beep('bad');
      if (s.voice) say('Нет решения');
      else Alert.alert('Нет решения', 'Нет данных от приёмника.');
      return;
    }
    const need = epochsFor(s, code);
    const go = (any: boolean) => {
      lastTs.current = p.timestamp; // берём только эпохи после нажатия
      setSamples([]);
      setShot({ code, need, any });
      beep('start');
    };
    if (p.quality !== 'fix') {
      if (s.waitFix) { go(false); if (s.voice) say('Жду фикс'); return; }
      Alert.alert(`Нет FIX (${p.quality.toUpperCase()})`, 'Снять точку без фиксированного решения?', [
        { text: 'Отмена', style: 'cancel' }, { text: 'Снять', onPress: () => go(true) },
      ]);
      return;
    }
    go(false);
  };

  const cancel = () => { setShot(null); setSamples([]); };

  /** Плавающая кнопка, клавиша громкости, автоспуск: снять текущий объект или отменить идущее. */
  const trigger = () => {
    const { shot: sh, cur: c, cfg: cf } = live.current;
    if (sh) { cancel(); beep('bad'); return; }
    if (!c || !cf.codes.some((x) => x.code === c)) {
      beep('bad');
      Alert.alert('Нет объекта', 'Выберите объект — дальше кнопка и клавиша громкости снимают его.');
      return;
    }
    start(c);
  };

  // новая эпоха — в выборку; FIX потерян — копим заново
  useEffect(() => {
    if (!shot || !position || position.timestamp === lastTs.current) return;
    lastTs.current = position.timestamp;
    if (!shot.any && position.quality !== 'fix') { setSamples([]); return; }
    setSamples((prev) => [...prev, position]);
  }, [position, shot]);

  // выборка набрана
  useEffect(() => {
    if (!shot || samples.length < shot.need) return;
    const n = samples.length;
    const mean = (f: (p: LivePosition) => number) => samples.reduce((a, p) => a + f(p), 0) / n;
    const r: LivePosition = {
      latitude: mean((p) => p.latitude),
      longitude: mean((p) => p.longitude),
      elevation: mean((p) => p.elevation) - cfg.pole,
      hAccuracy: Math.max(...samples.map((p) => p.hAccuracy)),
      vAccuracy: Math.max(...samples.map((p) => p.vAccuracy)),
      quality: samples.reduce<FixQuality>((w, p) => (QUALITY_RANK[p.quality] < QUALITY_RANK[w] ? p.quality : w), 'fix'),
      satellites: Math.min(...samples.map((p) => p.satellites ?? 0)),
      timestamp: Date.now(),
    };
    const code = shot.code;
    setShot(null);
    setSamples([]);
    if (code == null) cfg.onManual?.(r, n);
    else save(code, r, n, false);
  }, [samples, shot]);

  // автосъёмка: точка текущего объекта каждые autoStep метров, только FIX в допуске
  useEffect(() => {
    if (!autoOn || shot || busy.current || !settings || !cur || !position || position.quality !== 'fix') return;
    const r = { ...position, elevation: position.elevation - cfg.pole };
    const p = planar(r);
    const last = lastAuto.current;
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < settings.autoStep) return;
    save(cur, r, 1, true);
  }, [position, autoOn]);

  useStillness(stillOn && !shot, () => { if (!live.current.shot) trigger(); });

  const setStage = (v: string) => {
    setStageState(v);
    if (cfg.projectId) kvSet(`stage:${cfg.projectId}`, v);
    if (settings?.voice) say(v ? `Съёмка ${v}` : 'Обычная съёмка');
  };
  const cycleStage = () => setStage(STAGES[(STAGES.indexOf(stage as typeof STAGES[number]) + 1) % STAGES.length]);

  const toggleSeq = () => {
    const v = !seqOn;
    setSeqOn(v);
    kvSet('shotSeqOn', v ? '1' : '0');
    if (v && settings?.seq[0] && !settings.seq.includes(cur ?? '')) setCur(settings.seq[0]);
    if (settings?.voice) say(v ? `Поперечник: ${settings.seq.map(desc).join(', ')}` : 'Поперечник выключен');
  };
  const toggleAuto = () => {
    const v = !autoOn;
    lastAuto.current = null; // первая точка — сразу на месте включения
    setAutoOn(v);
    if (settings?.voice) say(v ? `Автосъёмка через ${settings.autoStep} метров` : 'Автосъёмка выключена');
  };
  const toggleStill = () => {
    const v = !stillOn;
    setStillOn(v);
    if (settings?.voice) say(v ? 'Замер по остановке включён' : 'Замер по остановке выключен');
  };

  const need = shot?.need ?? (settings ? epochsFor(settings, cur) : 1);
  return {
    settings, cur, setCur,
    running: shot != null,
    runningCode: shot?.code ?? null,
    count: samples.length,
    need,
    waitingFix: shot != null && !shot.any && position?.quality !== 'fix',
    start, cancel, trigger,
    seqOn, toggleSeq, autoOn, toggleAuto, stillOn, toggleStill,
    stage, setStage, cycleStage, lastInfo,
  };
}

export type ShotEngine = ReturnType<typeof useShot>;
