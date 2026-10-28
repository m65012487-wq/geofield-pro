import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Modal, TextInput, Switch } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card, QualityBadge } from '../src/components/ui';
import { useGnss } from '../src/lib/useGnss';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useAverager } from '../src/lib/useAverager';
import { useCalibration, saveCalib } from '../src/lib/calibStore';
import { listKnown, countKnown, kvGet } from '../src/db/database';
import type { KnownPoint } from '../src/db/types';
import type { CalibPair } from '../src/lib/calib';

/**
 * Калибровка (как в LandStar): встать вехой на репер с известными местными координатами,
 * измерить — пара попадает в расчёт. 2 пункта — план, 3+ — план с контролем и наклон по высоте.
 */
export default function CalibrationScreen() {
  const router = useRouter();
  const { project } = useActiveProject();
  const { position } = useGnss();
  const calib = useCalibration(project?.id);
  const [nKnown, setNKnown] = useState(0);
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [known, setKnown] = useState<KnownPoint[]>([]);
  const [target, setTarget] = useState<KnownPoint | null>(null);
  const [antH, setAntH] = useState(2);
  const [epochs, setEpochs] = useState(10);

  useFocusEffect(useCallback(() => {
    if (!project) return;
    countKnown(project.id).then(setNKnown);
    kvGet('antennaHeight').then((v) => v && setAntH(parseFloat(v)));
    kvGet('avgEpochs').then((v) => v && setEpochs(Math.max(10, parseInt(v, 10) || 10)));
  }, [project?.id]));

  const pairs = calib?.pairs ?? [];
  const cal = calib?.cal ?? null;

  const avg = useAverager(position, epochs, async (m, k) => {
    if (!project || !target) return;
    const pair: CalibPair = {
      name: target.name, north: target.north, east: target.east, height: target.height,
      lat: m.latitude, lon: m.longitude, h: m.elevation - antH, useHz: true, useV: true,
    };
    const rest = pairs.filter((p) => p.name !== target.name);
    try {
      await saveCalib(project.id, [...rest, pair]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Пункт измерен', `${target.name}: ${k} эпох, σ ${m.hAccuracy.toFixed(3)} м`);
    } catch (e) {
      Alert.alert('Ошибка расчёта', e instanceof Error ? e.message : String(e));
    }
    setTarget(null);
  });

  const openPicker = async () => {
    if (!project) return;
    setKnown(await listKnown(project.id, search));
    setPicker(true);
  };

  const measure = (kp: KnownPoint) => {
    setPicker(false);
    if (!position || position.quality === 'none') { Alert.alert('Нет решения', 'Нет данных от приёмника.'); return; }
    setTarget(kp);
    if (position.quality !== 'fix') {
      Alert.alert('Нет FIX', `Калибровка по ${position.quality.toUpperCase()} даст ошибку в дециметры. Мерить всё равно?`, [
        { text: 'Отмена', style: 'cancel', onPress: () => setTarget(null) },
        { text: 'Мерить', onPress: () => avg.start(true) },
      ]);
      return;
    }
    avg.start(false);
  };

  const toggle = (name: string, field: 'useHz' | 'useV') => {
    if (!project) return;
    saveCalib(project.id, pairs.map((p) => (p.name === name ? { ...p, [field]: !p[field] } : p)))
      .catch((e) => Alert.alert('Ошибка', e.message));
  };

  const remove = (name: string) => {
    if (!project) return;
    Alert.alert('Убрать пункт', `Убрать ${name} из калибровки?`, [
      { text: 'Нет', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => saveCalib(project.id, pairs.filter((p) => p.name !== name)) },
    ]);
  };

  if (!project) return <View style={shared.container}><Text style={[shared.muted, { padding: space.lg }]}>Выберите проект.</Text></View>;

  const res = new Map((cal?.residuals ?? []).map((r) => [r.name, r]));
  return (
    <View style={shared.container}>
      <ScrollView contentContainerStyle={[shared.pad, { paddingBottom: 120 }]}>
        <Card style={{ marginBottom: space.lg }}>
          <View style={styles.head}>
            <Text style={styles.title}>{cal ? 'Калибровка рассчитана' : 'Калибровки нет'}</Text>
            <QualityBadge quality={position?.quality ?? 'none'} />
          </View>
          {cal ? (
            <Text style={styles.meta}>
              Пунктов: план {pairs.filter((p) => p.useHz).length}, высота {pairs.filter((p) => p.useV).length}
              {'\n'}Масштаб {cal.scale.toFixed(7)} ({((cal.scale - 1) * 1e6).toFixed(0)} мм/км), поворот {fmtAngle(cal.rotationSec)}
              {'\n'}Наклон высот: N {(cal.gN * 1e6).toFixed(1)} мм/км, E {(cal.gE * 1e6).toFixed(1)} мм/км
            </Text>
          ) : (
            <Text style={styles.meta}>
              Нужно минимум 2 репера (лучше 4–5 по всей длине участка). Встаньте вехой на репер и нажмите «Измерить репер».
            </Text>
          )}
        </Card>

        <Pressable style={styles.knownRow} onPress={() => router.push('/known')}>
          <Text style={styles.knownText}>Реперы проекта: {nKnown}</Text>
          <Text style={styles.link}>Импорт / список ›</Text>
        </Pressable>

        {pairs.length > 0 && (
          <View style={styles.table}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.td, styles.c1]}>Пункт</Text>
              <Text style={styles.td}>dN</Text><Text style={styles.td}>dE</Text><Text style={styles.td}>dH</Text>
              <Text style={styles.tdS}>План</Text><Text style={styles.tdS}>Выс.</Text>
            </View>
            {pairs.map((p) => {
              const r = res.get(p.name);
              return (
                <Pressable key={p.name} style={styles.tr} onLongPress={() => remove(p.name)}>
                  <Text style={[styles.td, styles.c1]} numberOfLines={1}>{p.name}</Text>
                  <Text style={[styles.td, bad(r?.dN, p.useHz)]}>{mm(r?.dN)}</Text>
                  <Text style={[styles.td, bad(r?.dE, p.useHz)]}>{mm(r?.dE)}</Text>
                  <Text style={[styles.td, bad(r?.dH, p.useV)]}>{mm(r?.dH)}</Text>
                  <View style={styles.tdS}><Switch value={p.useHz} onValueChange={() => toggle(p.name, 'useHz')} /></View>
                  <View style={styles.tdS}><Switch value={p.useV} onValueChange={() => toggle(p.name, 'useV')} /></View>
                </Pressable>
              );
            })}
            <Text style={[shared.muted, { marginTop: space.sm }]}>
              Невязки в мм. Больше 30 мм — красным: репер сбит или ошибка в каталоге, отключите его. Удержать строку — убрать пункт.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.bar}>
        <Button
          label={avg.running ? `${target?.name}: ${avg.count}/${epochs} — отмена` : '◉  ИЗМЕРИТЬ РЕПЕР'}
          variant={avg.running ? 'danger' : 'primary'}
          onPress={avg.running ? () => { avg.cancel(); setTarget(null); } : openPicker}
          disabled={!avg.running && nKnown === 0}
        />
      </View>

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <View style={shared.modalOverlay}>
          <View style={[shared.modalSheet, { maxHeight: '80%' }]}>
            <Text style={shared.modalTitle}>На каком репере стоите?</Text>
            <TextInput style={shared.input} value={search} placeholder="Поиск по имени"
              placeholderTextColor={colors.textMuted}
              onChangeText={(t) => { setSearch(t); listKnown(project.id, t).then(setKnown); }} />
            <ScrollView style={{ marginTop: space.sm }}>
              {known.slice(0, 200).map((k) => (
                <Pressable key={k.id} style={styles.pick} onPress={() => measure(k)}>
                  <Text style={styles.pickName}>{k.name}</Text>
                  <Text style={styles.pickMeta}>N {k.north.toFixed(3)}  E {k.east.toFixed(3)}  H {k.height.toFixed(3)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Button label="Отмена" variant="secondary" onPress={() => setPicker(false)} style={{ marginTop: space.md }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const mm = (v?: number) => (v == null ? '–' : (v * 1000).toFixed(0));
const bad = (v: number | undefined, used: boolean) =>
  v != null && used && Math.abs(v) > 0.03 ? { color: colors.danger } : !used ? { color: colors.textMuted } : null;
function fmtAngle(sec: number) {
  const s = Math.abs(sec), d = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${sec < 0 ? '−' : ''}${d}°${String(m).padStart(2, '0')}′${(s % 60).toFixed(1)}″`;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800' },
  meta: { color: colors.textSecondary, fontSize: font.small, marginTop: space.sm, lineHeight: 20 },
  knownRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: space.lg,
  },
  knownText: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700' },
  link: { color: colors.accent, fontSize: font.small, fontWeight: '800' },
  table: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.sm },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { borderBottomColor: colors.borderStrong },
  td: { flex: 1, color: colors.textPrimary, fontSize: font.small, textAlign: 'right', fontVariant: ['tabular-nums'] },
  tdS: { width: 56, alignItems: 'center', color: colors.textMuted, fontSize: font.caption, textAlign: 'center' },
  c1: { flex: 2, textAlign: 'left', fontWeight: '700' },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.md,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
  pick: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickName: { color: colors.textPrimary, fontSize: font.body, fontWeight: '800' },
  pickMeta: { color: colors.textMuted, fontSize: font.caption, fontVariant: ['tabular-nums'] },
});
