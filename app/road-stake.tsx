import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card, QualityBadge } from '../src/components/ui';
import { HelpButton, ScreenHelp } from '../src/components/Help';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useGnss } from '../src/lib/useGnss';
import { localOf, useCalibration } from '../src/lib/calibStore';
import { useRoad } from '../src/lib/roadCheck';
import { fmtPk, parsePk, stationOf } from '../src/lib/road';
import { pointAt } from '../src/lib/roadGeom';
import { addPoint, kvGet, nextNameForCode } from '../src/db/database';
import { beep, say } from '../src/lib/feedback';

/** Попадание в цель, м. */
const HIT = 0.10;
const MAX_TARGETS = 2000;

interface Target { s: number; off: number; north: number; east: number; h: number | null }

const num = (v: string) => parseFloat(v.replace(',', '.'));
const fmtOffShort = (o: number) => (o === 0 ? 'ось' : `${o > 0 ? '+' : '−'}${Math.abs(o)}`);

/** Разбивка по оси: цели «ПК × смещение», живая навигация к текущей цели и отметка вынесенных точек. */
export default function RoadStakeScreen() {
  const router = useRouter();
  const { project } = useActiveProject();
  const road = useRoad(project?.id);
  const calib = useCalibration(project?.id);
  const { position } = useGnss();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [step, setStep] = useState('20');
  const [offs, setOffs] = useState('0');
  const [code, setCode] = useState('VYN');
  const [targets, setTargets] = useState<Target[]>([]);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [antH, setAntH] = useState(2);
  const [tilt, setTilt] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const hitFor = useRef<number>(-1);

  useFocusEffect(useCallback(() => {
    kvGet('antennaHeight').then((v) => { const x = parseFloat(v ?? ''); if (Number.isFinite(x)) setAntH(x); });
    kvGet('tiltByReceiver').then((v) => setTilt(v === '1'));
    kvGet('voice').then((v) => setVoiceOn(v !== '0'));
  }, []));
  const pole = tilt ? 0 : antH;

  useEffect(() => {
    if (road && !from && !to) {
      setFrom(fmtPk(road.pk[0], 0));
      setTo(fmtPk(road.pk[road.pk.length - 1], 0));
    }
  }, [road]);

  const build = () => {
    if (!road) return;
    const a = parsePk(from); const b = parsePk(to); const st = num(step);
    if (a == null || b == null) return Alert.alert('ПК', 'Введите «от ПК» и «до ПК»: 12+40 или метры.');
    if (!Number.isFinite(st) || st <= 0) return Alert.alert('Шаг', 'Шаг должен быть больше нуля.');
    const os = offs.split(/[;,\s]+/).filter(Boolean).map(num);
    if (!os.length || os.some((x) => !Number.isFinite(x))) return Alert.alert('Смещение', 'Например: -3.5, 0, 3.5');
    const lo = Math.min(a, b); const hi = Math.max(a, b);
    if ((hi - lo) / st * os.length > MAX_TARGETS) {
      return Alert.alert('Слишком много целей', `Не более ${MAX_TARGETS}. Увеличьте шаг или сузьте участок.`);
    }
    const stations: number[] = [];
    for (let s = lo; s < hi - 1e-6; s += st) stations.push(s);
    stations.push(hi);
    if (a > b) stations.reverse();
    const list: Target[] = [];
    for (const s of stations) {
      for (const o of os) {
        const p = pointAt(road, s, o);
        list.push({ s, off: o, north: p.north, east: p.east, h: p.hDesign });
      }
    }
    setTargets(list); setIdx(0); setDone(new Set()); hitFor.current = -1;
  };

  const live = position && position.quality !== 'none'
    ? localOf(calib, position.latitude, position.longitude, position.elevation - pole) : null;
  const target = targets[idx] ?? null;

  const nav = useMemo(() => {
    if (!road || !live || !target) return null;
    const st = stationOf(road, live.north, live.east);
    const fwd = target.s - st.s;
    const right = target.off - st.off;
    const dist = Math.hypot(live.north - target.north, live.east - target.east);
    const dz = target.h != null ? target.h - live.height : null;
    return { fwd, right, dist, dz };
  }, [road, live?.north, live?.east, live?.height, target]);

  // попадание: сигнал один раз на цель
  useEffect(() => {
    if (!nav || !target) return;
    if (nav.dist <= HIT && hitFor.current !== idx) {
      hitFor.current = idx;
      beep('done');
      if (voiceOn) say('На точке');
    } else if (nav.dist > HIT * 3 && hitFor.current === idx) {
      hitFor.current = -1; // ушли — сработает снова при возврате
    }
  }, [nav?.dist, idx]);

  const mark = async () => {
    if (!project || !position || !live || !target || saving) return;
    setSaving(true);
    try {
      const c = code.trim() || 'VYN';
      const name = await nextNameForCode(project.id, c);
      await addPoint({
        projectId: project.id, name, code: c,
        latitude: position.latitude, longitude: position.longitude, elevation: position.elevation,
        quality: position.quality, hAccuracy: position.hAccuracy, vAccuracy: position.vAccuracy,
        epochs: 1, note: `вынос ПК${fmtPk(target.s)} ${fmtOffShort(target.off)}`,
        north: live.north, east: live.east, height: live.height, stage: '',
      });
      beep('done');
      setDone((d) => new Set(d).add(idx));
      setIdx((i) => Math.min(i + 1, targets.length - 1));
    } catch (e: any) {
      beep('bad');
      Alert.alert('Не сохранилось', String(e?.message ?? e));
    } finally { setSaving(false); }
  };

  if (!project) {
    return <View style={[shared.container, styles.center]}><Text style={shared.muted}>Сначала выберите проект.</Text></View>;
  }

  const help = (
    <ScreenHelp title="Разбивка по оси"
      text={'Что делает: выносит в натуру точки по оси дороги — на заданных пикетах и расстояниях от оси.\n\n'
        + 'Как пользоваться:\n1. Задайте участок «от ПК» и «до ПК» (12+40 или метры), шаг в метрах.\n'
        + '2. Смещение: «+» вправо по ходу пикетажа, «−» влево. Можно несколько через запятую: -3.5, 0, 3.5.\n'
        + '3. Нажмите «Построить цели». Идите к первой цели по подсказкам: вперёд/назад, вправо/влево.\n'
        + '4. Когда до цели ≤ 10 см — звуковой сигнал. Нажмите «Отметить вынесено» — точка запишется с кодом из поля и сразу откроется следующая цель.\n\n'
        + 'Если у цели есть проектная высота, показано «насыпать/срезать» в сантиметрах: проект минус земля под вехой.\n\n'
        + 'Нужно: загруженная ось (экран «Трасса»), калибровка проекта и связь с приёмником. Лучше работать в FIX.'} />
  );

  if (!road) {
    return (
      <View style={[shared.container, styles.center, { padding: space.lg }]}>
        {help}
        <Text style={[shared.muted, { textAlign: 'center', marginBottom: space.lg }]}>Для разбивки нужна трасса проекта (ось).</Text>
        <Button label="Загрузить трассу" onPress={() => router.push('/road' as any)} />
      </View>
    );
  }

  const near = nav != null && nav.dist <= HIT;
  const big = (v: number, pos: string, neg: string) => `${v >= 0 ? pos : neg} ${Math.abs(v).toFixed(2)} м`;

  return (
    <ScrollView style={shared.container} contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      {help}

      <Card>
        <View style={shared.row}>
          <Text style={[shared.sectionTitle, { flex: 1, marginBottom: 0 }]}>Цели</Text>
          <HelpButton size={20} title="Смещение и шаг"
            text={'Смещение — расстояние от оси в метрах: «+» вправо по ходу пикетажа, «−» влево, 0 — по оси. Несколько значений через запятую дадут ряд точек на каждом пикете, например -3.5, 0, 3.5 — кромки и ось.\n\nШаг — через сколько метров по оси ставить пикеты. Последняя цель всегда в конце участка.'} />
        </View>
        <View style={shared.row}>
          <View style={{ flex: 1 }}>
            <Text style={shared.label}>От ПК</Text>
            <TextInput style={shared.input} value={from} onChangeText={setFrom} placeholder="0+00"
              placeholderTextColor={colors.textMuted} autoCapitalize="none" />
          </View>
          <View style={{ width: space.md }} />
          <View style={{ flex: 1 }}>
            <Text style={shared.label}>До ПК</Text>
            <TextInput style={shared.input} value={to} onChangeText={setTo} placeholder="10+00"
              placeholderTextColor={colors.textMuted} autoCapitalize="none" />
          </View>
        </View>
        <View style={shared.row}>
          <View style={{ flex: 1 }}>
            <Text style={shared.label}>Шаг, м</Text>
            <TextInput style={shared.input} value={step} onChangeText={setStep} keyboardType="decimal-pad" />
          </View>
          <View style={{ width: space.md }} />
          <View style={{ flex: 2 }}>
            <Text style={shared.label}>Смещение, м (+вправо / −влево)</Text>
            <TextInput style={shared.input} value={offs} onChangeText={setOffs} placeholder="-3.5, 0, 3.5"
              placeholderTextColor={colors.textMuted} autoCapitalize="none" />
          </View>
        </View>
        <Text style={shared.label}>Код для отметки</Text>
        <TextInput style={shared.input} value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Button label="Построить цели" onPress={build} style={{ marginTop: space.md }} />
      </Card>

      {target && (
        <Card style={{ marginTop: space.lg }}>
          <View style={shared.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.prog}>{idx + 1} из {targets.length}{done.has(idx) ? ' · вынесено' : ''}</Text>
              <Text style={styles.tgt}>
                ПК {fmtPk(target.s)} · {target.off === 0 ? 'ось' : target.off > 0 ? `вправо ${target.off}` : `влево ${-target.off}`}
              </Text>
              <Text style={shared.muted}>
                Вынесено: {done.size}{target.h != null ? ` · H проект ${target.h.toFixed(3)}` : ' · H проекта нет'}
              </Text>
            </View>
            <QualityBadge quality={position?.quality ?? 'none'} />
          </View>

          {!live ? (
            <Text style={[shared.muted, { textAlign: 'center', marginVertical: space.xl }]}>
              {!position || position.quality === 'none' ? 'Ожидание позиции…' : 'Нет калибровки проекта — местные координаты недоступны.'}
            </Text>
          ) : nav && (
            <View style={[styles.nav, near && { borderColor: colors.fix }]}>
              {near ? <Text style={[styles.big, { color: colors.fix }]}>НА ТОЧКЕ</Text> : (
                <>
                  <Text style={styles.big}>{big(nav.fwd, 'вперёд', 'назад')}</Text>
                  <Text style={styles.big}>{big(nav.right, 'вправо', 'влево')}</Text>
                </>
              )}
              <Text style={styles.dist}>до цели {nav.dist.toFixed(2)} м</Text>
              {nav.dz != null && (
                <Text style={[styles.dz, { color: Math.abs(nav.dz) <= 0.02 ? colors.fix : colors.warning }]}>
                  {Math.abs(nav.dz) < 0.005 ? 'высота по проекту' : `${nav.dz > 0 ? 'насыпать' : 'срезать'} ${Math.abs(nav.dz * 100).toFixed(1)} см`}
                </Text>
              )}
            </View>
          )}

          <View style={[shared.row, { gap: space.md, marginTop: space.md }]}>
            <Button label="◀ пред" variant="secondary" style={{ flex: 1 }} disabled={idx === 0} onPress={() => setIdx(idx - 1)} />
            <Button label="след ▶" variant="secondary" style={{ flex: 1 }} disabled={idx >= targets.length - 1} onPress={() => setIdx(idx + 1)} />
          </View>
          <Button label="Отметить вынесено" onPress={mark} loading={saving} disabled={!live} style={{ marginTop: space.md }} />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  prog: { color: colors.accent, fontSize: font.bodyLg, fontWeight: '800' },
  tgt: { color: colors.textPrimary, fontSize: font.title, fontWeight: '700', marginVertical: 2 },
  nav: {
    borderWidth: 2, borderColor: colors.border, borderRadius: radius.lg, padding: space.lg,
    marginTop: space.md, alignItems: 'center', gap: space.xs, backgroundColor: colors.surfaceRaised,
  },
  big: { color: colors.textPrimary, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dist: { color: colors.textSecondary, fontSize: font.bodyLg, marginTop: space.xs },
  dz: { fontSize: font.title + 4, fontWeight: '800', marginTop: space.xs },
});
