import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, TextInput, Modal, Pressable,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, QualityBadge } from '../src/components/ui';
import { FloatingShutter } from '../src/components/FloatingShutter';
import { useShutter } from '../src/lib/useShutter';
import { SurveyCanvas } from '../src/components/SurveyCanvas';
import { MapCanvas, type MapPoint } from '../src/components/MapCanvas';
import { loadBasemap, type Basemap } from '../src/lib/basemap';
import { useGnss } from '../src/lib/useGnss';
import { useActiveProject } from '../src/lib/useActiveProject';
import {
  listPoints, listFeatures, addPoint, suggestPointName, listCodes, kvGet, kvSet,
  nextNamesForCodes, setNextNumber, deletePoint, updatePoint,
} from '../src/db/database';
import type { SurveyPoint, Feature, FeatureCode, LivePosition, FixQuality } from '../src/db/types';
import { useCalibration, localOf } from '../src/lib/calibStore';

const CANVAS_H = 220;
const QUALITY_RANK: Record<FixQuality, number> = { fix: 3, float: 2, single: 1, none: 0 };

/**
 * Съёмка точек как в LandStar: сетка кнопок объектов. Нажал кнопку — приёмник
 * усредняет эпохи, точка пишется с именем «код + номер» (у каждого кода свой счёт).
 * Кнопка «Снять точку» внизу — точка с ручным вводом имени.
 */
export default function SurveyScreen() {
  const router = useRouter();
  const { project } = useActiveProject();
  const gnss = useGnss();
  const { position } = gnss;
  const calib = useCalibration(project?.id);

  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [codes, setCodes] = useState<FeatureCode[]>([]);
  const [nextNames, setNextNames] = useState<Record<string, string>>({});
  const [canvasW, setCanvasW] = useState(0);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [avgEpochs, setAvgEpochs] = useState(2);
  const [accLimit, setAccLimit] = useState(0.05);
  const [antH, setAntH] = useState(2.0);
  // приёмник с компенсацией наклона уже даёт остриё вехи — тогда веху не вычитаем
  const [tiltByReceiver, setTiltByReceiver] = useState(false);
  const pole = tiltByReceiver ? 0 : antH;

  // Усреднение: копим эпохи из живого потока (каждая новая позиция — эпоха)
  const [sampling, setSampling] = useState<{ code: string | null; anyQuality: boolean } | null>(null);
  const [samples, setSamples] = useState<LivePosition[]>([]);
  const lastTs = useRef(0);

  // Ручной режим и правка
  const [saving, setSaving] = useState(false);
  const [avg, setAvg] = useState<LivePosition | null>(null);
  const [ptName, setPtName] = useState('');
  const [ptCode, setPtCode] = useState('');
  const [ptNote, setPtNote] = useState('');
  const [editing, setEditing] = useState<SurveyPoint | null>(null);
  const [codePicker, setCodePicker] = useState(false);
  const [antEdit, setAntEdit] = useState<string | null>(null);
  const [numEdit, setNumEdit] = useState<{ code: string; value: string } | null>(null);
  // текущий объект для плавающей кнопки и клавиши громкости — общий с «Картой»
  const [curCode, setCurCode] = useState<string | null>(null);
  const [floatOn, setFloatOn] = useState(true);

  const load = useCallback(() => {
    if (!project) return;
    listPoints(project.id).then(setPoints);
    listFeatures(project.id).then(setFeatures);
    listCodes().then((cs) => {
      setCodes(cs);
      nextNamesForCodes(project.id, cs.map((c) => c.code)).then(setNextNames);
    });
    kvGet('avgEpochs').then((v) => v && setAvgEpochs(parseInt(v, 10) || 2));
    kvGet('tiltByReceiver').then((v) => setTiltByReceiver(v === '1'));
    kvGet('accLimit').then((v) => v && setAccLimit(parseFloat(v) || 0.05));
    kvGet('antennaHeight').then((v) => v && setAntH(parseFloat(v)));
    kvGet('mapCode').then((v) => v && setCurCode(v));
    kvGet('floatShutter').then((v) => setFloatOn(v !== '0'));
    loadBasemap(project.id).then(setBasemap);
  }, [project?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Новая эпоха -> в выборку
  useEffect(() => {
    if (!sampling || !position || position.timestamp === lastTs.current) return;
    lastTs.current = position.timestamp;
    if (!sampling.anyQuality && position.quality !== 'fix') {
      setSamples([]); // FIX потерян — начинаем заново
      return;
    }
    setSamples((prev) => [...prev, position]);
  }, [position, sampling]);

  const begin = (code: string | null) => {
    const p = position;
    if (!p || p.quality === 'none') {
      Alert.alert('Нет решения', 'Нет данных от приёмника.');
      return;
    }
    if (code) { setCurCode(code); kvSet('mapCode', code); }
    const go = (any: boolean) => {
      lastTs.current = p.timestamp;
      setSamples([]);
      setSampling({ code, anyQuality: any });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    };
    if (p.quality !== 'fix') {
      Alert.alert(`Нет FIX (${p.quality.toUpperCase()})`, 'Снять точку без фиксированного решения?', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Снять', onPress: () => go(true) },
      ]);
      return;
    }
    go(false);
  };

  const cancel = () => { setSampling(null); setSamples([]); };

  // Выборка набрана
  useEffect(() => {
    if (!sampling || samples.length < avgEpochs || !project) return;
    const n = samples.length;
    const mean = (sel: (p: LivePosition) => number) => samples.reduce((a, p) => a + sel(p), 0) / n;
    const worst = samples.reduce<FixQuality>(
      (w, p) => (QUALITY_RANK[p.quality] < QUALITY_RANK[w] ? p.quality : w), 'fix');
    const result: LivePosition = {
      latitude: mean((p) => p.latitude),
      longitude: mean((p) => p.longitude),
      elevation: mean((p) => p.elevation) - pole,
      hAccuracy: Math.max(...samples.map((p) => p.hAccuracy)),
      vAccuracy: Math.max(...samples.map((p) => p.vAccuracy)),
      quality: worst,
      satellites: Math.min(...samples.map((p) => p.satellites ?? 0)),
      timestamp: Date.now(),
    };
    const code = sampling.code;
    setSampling(null);
    setSamples([]);

    if (code == null) {
      // ручной режим — форма с именем
      setAvg(result);
      suggestPointName(project.id).then((nm) => { setPtName(nm); setPtCode(''); setPtNote(''); setSaving(true); });
      return;
    }
    const name = nextNames[code] ?? code;
    const loc = localOf(calib, result.latitude, result.longitude, result.elevation);
    const save = async () => {
      await addPoint({
        projectId: project.id, name, code,
        latitude: result.latitude, longitude: result.longitude, elevation: result.elevation,
        quality: result.quality, hAccuracy: result.hAccuracy, vAccuracy: result.vAccuracy,
        epochs: n, note: '', north: loc?.north ?? null, east: loc?.east ?? null, height: loc?.height ?? null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      load();
    };
    if (result.hAccuracy > accLimit) {
      Alert.alert('Низкая точность', `${name}: σ план ${result.hAccuracy.toFixed(3)} м хуже допуска ${accLimit} м.`, [
        { text: 'Не сохранять', style: 'cancel' },
        { text: 'Сохранить', onPress: save },
      ]);
    } else {
      save();
    }
  }, [samples, sampling, avgEpochs, accLimit, pole, project, nextNames, calib]);

  const handleManualSave = async () => {
    if (!avg || !project) return;
    const loc = localOf(calib, avg.latitude, avg.longitude, avg.elevation);
    await addPoint({
      projectId: project.id, name: ptName.trim() || 'PT', code: ptCode.trim(),
      latitude: avg.latitude, longitude: avg.longitude, elevation: avg.elevation,
      quality: avg.quality, hAccuracy: avg.hAccuracy, vAccuracy: avg.vAccuracy,
      epochs: avgEpochs, note: ptNote.trim(), north: loc?.north ?? null, east: loc?.east ?? null, height: loc?.height ?? null,
    });
    setSaving(false); setAvg(null);
    load();
  };

  const last = points[0];

  const editLast = () => {
    if (!last) return;
    setEditing(last); setPtName(last.name); setPtCode(last.code); setPtNote(last.note);
  };
  const saveEdit = async () => {
    if (!editing) return;
    await updatePoint(editing.id, { name: ptName.trim() || editing.name, code: ptCode.trim(), note: ptNote.trim() });
    setEditing(null);
    load();
  };
  const removeLast = () => {
    if (!last || !project) return;
    Alert.alert('Удалить точку', `Удалить ${last.name}?`, [
      { text: 'Нет', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deletePoint(last.id, project.id).then(load) },
    ]);
  };

  const shoot = () => {
    if (sampling) { cancel(); return; }
    if (!curCode || !codes.some((c) => c.code === curCode)) { Alert.alert('Нет объекта', 'Нажмите плитку объекта — дальше кнопка и клавиша громкости снимают тот же объект.'); return; }
    begin(curCode);
  };
  useShutter(shoot);

  if (!project) {
    return (
      <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={shared.muted}>Сначала выберите проект.</Text>
        <Button label="К проектам" variant="secondary" onPress={() => router.replace('/(tabs)')}
          style={{ marginTop: space.lg, minWidth: 200 }} />
      </View>
    );
  }

  const q = position?.quality ?? 'none';
  const live = position ? localOf(calib, position.latitude, position.longitude, position.elevation - pole) : null;
  return (
    <View style={shared.container}>
      {/* Строка состояния приёмника */}
      <Pressable style={styles.statusBar} onPress={() => router.push('/receiver')}>
        <QualityBadge quality={q} />
        <View style={{ flex: 1, marginLeft: space.md }}>
          <Text style={styles.statusMain} numberOfLines={1}>
            {position
              ? `${position.satellites ?? '–'} сп.  σ ${fmt(position.hAccuracy)} / ${fmt(position.vAccuracy)}`
                + (position.diffAge != null && position.diffAge >= 0 ? `  попр. ${position.diffAge.toFixed(0)} с` : '')
              : gnss.message || 'Нет данных'}
          </Text>
          <Text style={styles.statusSub} numberOfLines={1}>
            {live
              ? `N ${live.north.toFixed(3)}  E ${live.east.toFixed(3)}  H ${live.height.toFixed(3)}`
              : `${gnss.deviceName ?? 'Приёмник не выбран'} · без калибровки (WGS84)`}
          </Text>
        </View>
        <Pressable onPress={() => setAntEdit(antH.toFixed(3))} hitSlop={10} style={styles.antBtn}>
          <Text style={styles.antText}>{tiltByReceiver ? '⟂ IMU' : `⟂ ${antH.toFixed(3)}`}</Text>
        </Pressable>
      </Pressable>

      <ScrollView contentContainerStyle={{ padding: space.md, paddingBottom: 110 }}>
        <View onLayout={(e) => setCanvasW(e.nativeEvent.layout.width)} style={{ marginBottom: space.md }}>
          {canvasW > 0 && (calib?.cal || basemap ? (
            <MapCanvas compact width={canvasW} height={CANVAS_H + 80} basemap={basemap}
              here={live ? { north: live.north, east: live.east } : null}
              points={points.flatMap<MapPoint>((p) => {
                const l = p.north != null && p.east != null ? { north: p.north, east: p.east } : localOf(calib, p.latitude, p.longitude, p.elevation);
                const color = codes.find((c) => c.code === p.code)?.color;
                return l ? [{ id: p.id, name: p.name, north: l.north, east: l.east, color }] : [];
              })} />
          ) : (
            <SurveyCanvas position={position} points={points} features={features} width={canvasW} height={CANVAS_H} />
          ))}
        </View>

        {/* Кнопки объектов */}
        <View style={styles.grid}>
          {codes.map((c) => {
            const active = sampling?.code === c.code;
            return (
              <Pressable key={c.id}
                onPress={() => (sampling ? (active ? cancel() : null) : begin(c.code))}
                onLongPress={() => setNumEdit({ code: c.code, value: (nextNames[c.code] ?? c.code).slice(c.code.length) })}
                style={({ pressed }) => [styles.tile, { borderColor: c.color, opacity: pressed ? 0.7 : sampling && !active ? 0.45 : 1 },
                  active && { backgroundColor: c.color + '33' }]}>
                <View style={[styles.tileStripe, { backgroundColor: c.color }]} />
                <Text style={styles.tileTitle} numberOfLines={2}>{c.description || c.code}</Text>
                <Text style={[styles.tileNext, { color: c.color }]}>
                  {active ? `${samples.length}/${avgEpochs}` : nextNames[c.code] ?? c.code}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[shared.muted, { marginTop: space.sm }]}>
          Нажать — снять точку ({avgEpochs} эп. FIX). Удержать — задать номер.
        </Text>

        {last && (
          <View style={styles.lastRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lastName}>{last.name}  <Text style={styles.lastMeta}>{last.code}</Text></Text>
              <Text style={styles.lastMeta}>
                H {(last.height ?? last.elevation).toFixed(3)} · σ {fmt(last.hAccuracy)} · {last.quality.toUpperCase()} · всего {points.length}
              </Text>
            </View>
            <Pressable onPress={editLast} style={styles.smallBtn}><Text style={styles.smallBtnText}>Правка</Text></Pressable>
            <Pressable onPress={removeLast} style={styles.smallBtn}><Text style={[styles.smallBtnText, { color: colors.danger }]}>Удалить</Text></Pressable>
          </View>
        )}
      </ScrollView>

      <View style={styles.captureBar}>
        <Button
          label={sampling ? `Усреднение… ${samples.length}/${avgEpochs} — отмена` : '◉  СНЯТЬ ТОЧКУ (своё имя)'}
          onPress={sampling ? cancel : () => begin(null)}
          variant={sampling ? 'danger' : 'secondary'}
        />
      </View>

      {floatOn && (() => {
        const cc = codes.find((c) => c.code === curCode);
        return (
          <FloatingShutter color={cc?.color ?? colors.accent} running={sampling != null} onPress={shoot}
            label={sampling ? `${samples.length}/${avgEpochs}` : cc ? nextNames[cc.code] ?? cc.code : '—'} />
        );
      })()}

      {/* Форма: ручное сохранение или правка последней */}
      <Modal visible={saving || editing != null} transparent animationType="slide"
        onRequestClose={() => { setSaving(false); setEditing(null); }}>
        <View style={shared.modalOverlay}>
          <View style={shared.modalSheet}>
            <Text style={shared.modalTitle}>{editing ? `Правка ${editing.name}` : 'Сохранение точки'}</Text>
            <Text style={shared.label}>Имя точки</Text>
            <TextInput style={shared.input} value={ptName} onChangeText={setPtName} autoCapitalize="characters" />
            <Text style={shared.label}>Код объекта</Text>
            <Pressable style={[shared.input, { justifyContent: 'center' }]} onPress={() => setCodePicker(true)}>
              <Text style={{ color: ptCode ? colors.textPrimary : colors.textMuted, fontSize: font.body }}>
                {ptCode || 'Выбрать…'}
              </Text>
            </Pressable>
            <Text style={shared.label}>Примечание</Text>
            <TextInput style={shared.input} value={ptNote} onChangeText={setPtNote}
              placeholder="необязательно" placeholderTextColor={colors.textMuted} />
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <Button label="Отмена" variant="secondary" style={{ flex: 1 }}
                onPress={() => { setSaving(false); setEditing(null); setAvg(null); }} />
              <Button label="Сохранить" style={{ flex: 1 }} onPress={editing ? saveEdit : handleManualSave} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={codePicker} transparent animationType="fade" onRequestClose={() => setCodePicker(false)}>
        <View style={shared.modalOverlay}>
          <View style={[shared.modalSheet, { maxHeight: '70%' }]}>
            <Text style={shared.modalTitle}>Код объекта</Text>
            <ScrollView>
              <Pressable style={styles.codeRow} onPress={() => { setPtCode(''); setCodePicker(false); }}>
                <Text style={{ color: colors.textMuted, fontSize: font.body }}>Без кода</Text>
              </Pressable>
              {codes.map((c) => (
                <Pressable key={c.id} style={styles.codeRow} onPress={() => { setPtCode(c.code); setCodePicker(false); }}>
                  <View style={[styles.codeDot, { backgroundColor: c.color }]} />
                  <Text style={{ color: colors.textPrimary, fontSize: font.body, fontWeight: '700' }}>{c.code}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: font.small, flex: 1 }} numberOfLines={1}>  {c.description}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Высота вехи / следующий номер */}
      <Modal visible={antEdit != null || numEdit != null} transparent animationType="fade"
        onRequestClose={() => { setAntEdit(null); setNumEdit(null); }}>
        <View style={shared.modalOverlay}>
          <View style={shared.modalSheet}>
            <Text style={shared.modalTitle}>
              {antEdit != null ? 'Высота вехи, м' : `${numEdit?.code}: следующий номер`}
            </Text>
            <TextInput style={shared.input} keyboardType="decimal-pad" autoFocus
              value={antEdit ?? numEdit?.value ?? ''}
              onChangeText={(t) => (antEdit != null ? setAntEdit(t) : setNumEdit((s) => (s ? { ...s, value: t } : s)))} />
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <Button label="Отмена" variant="secondary" style={{ flex: 1 }}
                onPress={() => { setAntEdit(null); setNumEdit(null); }} />
              <Button label="OK" style={{ flex: 1 }} onPress={async () => {
                if (antEdit != null) {
                  const v = parseFloat(antEdit.replace(',', '.'));
                  if (Number.isFinite(v) && v >= 0 && v < 10) { setAntH(v); await kvSet('antennaHeight', String(v)); }
                  setAntEdit(null);
                } else if (numEdit) {
                  const n = parseInt(numEdit.value, 10);
                  if (n > 0) await setNextNumber(project.id, numEdit.code, n);
                  setNumEdit(null);
                  load();
                }
              }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function fmt(v: number | undefined | null) {
  if (v == null || !Number.isFinite(v)) return '–';
  return v < 1 ? v.toFixed(3) : v.toFixed(1);
}

const styles = StyleSheet.create({
  statusBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  statusMain: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statusSub: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
  antBtn: { paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  antText: { color: colors.textSecondary, fontSize: font.small, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: '-1%' },
  tile: {
    width: '31.33%', margin: '1%', minHeight: 86, padding: space.sm, paddingLeft: space.md, borderWidth: 1.5,
    borderRadius: radius.md, backgroundColor: colors.surface,
    justifyContent: 'space-between', overflow: 'hidden',
  },
  tileStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  tileTitle: { color: colors.textPrimary, fontSize: font.small, fontWeight: '700' },
  tileNext: { fontSize: font.bodyLg, fontWeight: '800', fontVariant: ['tabular-nums'] },
  lastRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border,
  },
  lastName: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800' },
  lastMeta: { color: colors.textMuted, fontSize: font.small, fontWeight: '400' },
  smallBtn: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  smallBtnText: { color: colors.textPrimary, fontSize: font.small, fontWeight: '700' },
  captureBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  codeDot: { width: 12, height: 12, borderRadius: 6 },
});
