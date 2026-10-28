import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, TextInput, Modal, Pressable,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card, QualityBadge } from '../src/components/ui';
import { SurveyCanvas } from '../src/components/SurveyCanvas';
import { useGnss } from '../src/lib/useGnss';
import { fmtCoord, fmtMeters } from '../src/lib/geo';
import { useActiveProject } from '../src/lib/useActiveProject';
import {
  listPoints, listFeatures, addPoint, suggestPointName, listCodes, kvGet,
} from '../src/db/database';
import type { SurveyPoint, Feature, FeatureCode, LivePosition, FixQuality } from '../src/db/types';

const CANVAS_H = 280;
const QUALITY_RANK: Record<FixQuality, number> = { fix: 3, float: 2, single: 1, none: 0 };

export default function SurveyScreen() {
  const router = useRouter();
  const { project } = useActiveProject();
  const { position, status, errorMsg, start } = useGnss();

  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [codes, setCodes] = useState<FeatureCode[]>([]);
  const [canvasW, setCanvasW] = useState(0);
  const [avgEpochs, setAvgEpochs] = useState(5);
  const [accLimit, setAccLimit] = useState(10);

  // Усреднение
  const positionRef = useRef<LivePosition | null>(null);
  positionRef.current = position;
  const [sampling, setSampling] = useState(false);
  const [samples, setSamples] = useState<LivePosition[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Форма сохранения
  const [saving, setSaving] = useState(false);
  const [avg, setAvg] = useState<LivePosition | null>(null);
  const [ptName, setPtName] = useState('');
  const [ptCode, setPtCode] = useState('');
  const [ptNote, setPtNote] = useState('');
  const [codePicker, setCodePicker] = useState(false);

  const load = useCallback(() => {
    if (!project) return;
    listPoints(project.id).then(setPoints);
    listFeatures(project.id).then(setFeatures);
    listCodes().then(setCodes);
    kvGet('avgEpochs').then((v) => v && setAvgEpochs(parseInt(v, 10) || 5));
    kvGet('accLimit').then((v) => v && setAccLimit(parseFloat(v) || 10));
  }, [project?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startSampling = () => {
    if (!positionRef.current) {
      Alert.alert('Нет сигнала GPS', 'Дождитесь определения позиции.');
      return;
    }
    setSamples([]);
    setSampling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    timerRef.current = setInterval(() => {
      const p = positionRef.current;
      if (!p) return;
      setSamples((prev) => [...prev, p]);
    }, 1000);
  };

  const cancelSampling = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setSampling(false);
    setSamples([]);
  };

  // Завершение усреднения
  useEffect(() => {
    if (!sampling || samples.length < avgEpochs) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    const n = samples.length;
    const mean = (sel: (p: LivePosition) => number) =>
      samples.reduce((a, p) => a + sel(p), 0) / n;
    const worst = samples.reduce<FixQuality>(
      (w, p) => (QUALITY_RANK[p.quality] < QUALITY_RANK[w] ? p.quality : w), 'fix');

    const result: LivePosition = {
      latitude: mean((p) => p.latitude),
      longitude: mean((p) => p.longitude),
      elevation: mean((p) => p.elevation),
      hAccuracy: mean((p) => p.hAccuracy),
      vAccuracy: mean((p) => p.vAccuracy),
      quality: worst,
      satellites: null,
      timestamp: Date.now(),
    };

    setSampling(false);
    setAvg(result);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    const proceed = () => {
      if (!project) return;
      suggestPointName(project.id).then((nm) => {
        setPtName(nm); setPtCode(''); setPtNote('');
        setSaving(true);
      });
    };

    if (result.hAccuracy > accLimit) {
      Alert.alert(
        'Низкая точность',
        `Точность ±${result.hAccuracy.toFixed(2)} м хуже порога ${accLimit} м. Сохранить всё равно?`,
        [
          { text: 'Отмена', style: 'cancel', onPress: () => setAvg(null) },
          { text: 'Сохранить', onPress: proceed },
        ]
      );
    } else {
      proceed();
    }
  }, [samples, sampling, avgEpochs, accLimit, project]);

  const handleSave = async () => {
    if (!avg || !project) return;
    await addPoint({
      projectId: project.id,
      name: ptName.trim() || 'PT',
      code: ptCode.trim(),
      latitude: avg.latitude,
      longitude: avg.longitude,
      elevation: avg.elevation,
      quality: avg.quality,
      hAccuracy: avg.hAccuracy,
      vAccuracy: avg.vAccuracy,
      epochs: avgEpochs,
      note: ptNote.trim(),
    });
    setSaving(false); setAvg(null);
    load();
  };

  if (!project) {
    return (
      <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={shared.muted}>Сначала выберите проект.</Text>
        <Button label="К проектам" variant="secondary" onPress={() => router.replace('/(tabs)')}
          style={{ marginTop: space.lg, minWidth: 200 }} />
      </View>
    );
  }

  return (
    <View style={shared.container}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 130 }}>
        <Card style={styles.gnssCard}>
          <View style={styles.gnssHeader}>
            <Text style={styles.cardTitle}>GNSS (GPS телефона)</Text>
            <QualityBadge quality={position?.quality ?? 'none'} />
          </View>
          {status === 'denied' && (
            <View style={{ gap: space.md }}>
              <Text style={{ color: colors.warning, fontSize: font.body }}>
                Нет доступа к геолокации. Разрешите в настройках и повторите.
              </Text>
              <Button label="Повторить" variant="secondary" onPress={start} />
            </View>
          )}
          {position ? (
            <View style={styles.coordGrid}>
              <Coord label="Широта" value={fmtCoord(position.latitude)} />
              <Coord label="Долгота" value={fmtCoord(position.longitude)} />
              <Coord label="Высота" value={fmtMeters(position.elevation, 2)} />
              <Coord label="Точность H" value={fmtMeters(position.hAccuracy, 2)} />
            </View>
          ) : status !== 'denied' ? (
            <Text style={{ color: colors.textSecondary, paddingVertical: space.md }}>
              {errorMsg ?? 'Определение позиции…'}
            </Text>
          ) : null}
        </Card>

        <View onLayout={(e) => setCanvasW(e.nativeEvent.layout.width)} style={{ marginBottom: space.lg }}>
          {canvasW > 0 && (
            <SurveyCanvas position={position} points={points} features={features}
              width={canvasW} height={CANVAS_H} />
          )}
        </View>

        <Text style={shared.muted}>
          Точек в проекте: {points.length}. Усреднение: {avgEpochs} эпох (настраивается).
        </Text>
      </ScrollView>

      <View style={styles.captureBar}>
        <Button
          label={sampling ? `Усреднение… ${samples.length}/${avgEpochs}` : position ? '◉  СНЯТЬ ТОЧКУ' : 'Ожидание GPS…'}
          onPress={sampling ? cancelSampling : startSampling}
          variant={sampling ? 'danger' : 'primary'}
          disabled={!position && !sampling}
        />
      </View>

      {/* Форма сохранения */}
      <Modal visible={saving} transparent animationType="slide" onRequestClose={() => setSaving(false)}>
        <View style={shared.modalOverlay}>
          <View style={shared.modalSheet}>
            <View style={styles.gnssHeader}>
              <Text style={shared.modalTitle}>Сохранение точки</Text>
              <QualityBadge quality={avg?.quality ?? 'none'} />
            </View>
            {avg && (
              <View style={styles.capCoords}>
                <Text style={styles.capCoord}>
                  {avg.latitude.toFixed(6)}, {avg.longitude.toFixed(6)}
                </Text>
                <Text style={styles.capMeta}>
                  H {avg.elevation.toFixed(2)} м · ±{avg.hAccuracy.toFixed(2)} м · {avgEpochs} эпох
                </Text>
              </View>
            )}
            <Text style={shared.label}>Имя точки</Text>
            <TextInput style={shared.input} value={ptName} onChangeText={setPtName}
              placeholderTextColor={colors.textMuted} />
            <Text style={shared.label}>Код объекта</Text>
            <Pressable style={[shared.input, styles.codeField]} onPress={() => setCodePicker(true)}>
              <Text style={{ color: ptCode ? colors.textPrimary : colors.textMuted, fontSize: font.body }}>
                {ptCode || 'Выбрать из библиотеки…'}
              </Text>
            </Pressable>
            <Text style={shared.label}>Примечание</Text>
            <TextInput style={shared.input} value={ptNote} onChangeText={setPtNote}
              placeholder="необязательно" placeholderTextColor={colors.textMuted} />
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <Button label="Отмена" variant="secondary"
                onPress={() => { setSaving(false); setAvg(null); }} style={{ flex: 1 }} />
              <Button label="Сохранить" onPress={handleSave} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Выбор кода */}
      <Modal visible={codePicker} transparent animationType="fade" onRequestClose={() => setCodePicker(false)}>
        <View style={shared.modalOverlay}>
          <View style={[shared.modalSheet, { maxHeight: '70%' }]}>
            <Text style={shared.modalTitle}>Код объекта</Text>
            <ScrollView>
              <Pressable style={styles.codeRow} onPress={() => { setPtCode(''); setCodePicker(false); }}>
                <Text style={{ color: colors.textMuted, fontSize: font.body }}>Без кода</Text>
              </Pressable>
              {codes.map((c) => (
                <Pressable key={c.id} style={styles.codeRow}
                  onPress={() => { setPtCode(c.code); setCodePicker(false); }}>
                  <View style={[styles.codeDot, { backgroundColor: c.color }]} />
                  <Text style={{ color: colors.textPrimary, fontSize: font.body, fontWeight: '700' }}>{c.code}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: font.small, flex: 1 }} numberOfLines={1}>
                    {'  '}{c.description}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Coord({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.coordCell}>
      <Text style={styles.coordLabel}>{label}</Text>
      <Text style={styles.coordValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gnssCard: { marginBottom: space.lg },
  gnssHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  cardTitle: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700' },
  coordGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  coordCell: { width: '50%', paddingVertical: space.sm },
  coordLabel: { color: colors.textMuted, fontSize: font.caption },
  coordValue: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '600', fontVariant: ['tabular-nums'] },
  captureBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
  capCoords: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  capCoord: { color: colors.textPrimary, fontSize: font.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  capMeta: { color: colors.textMuted, fontSize: font.small, marginTop: 4 },
  codeField: { justifyContent: 'center' },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  codeDot: { width: 12, height: 12, borderRadius: 6 },
});
