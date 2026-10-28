import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, font } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Button, Card } from '../../src/components/ui';
import { useActiveProject } from '../../src/lib/useActiveProject';
import { listPoints, addPoint, countPoints } from '../../src/db/database';
import { meanStd } from '../../src/lib/cogo';
import { toLocalMeters } from '../../src/lib/geo';
import type { SurveyPoint } from '../../src/db/types';

/** Осреднение: выбор точек проекта → среднее + СКО в метрах, сохранение результата. */
export default function AverageScreen() {
  const { project } = useActiveProject();
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    if (!project) return;
    listPoints(project.id).then(setPoints);
    setSelected(new Set());
  }, [project?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const result = useMemo(() => {
    const sel = points.filter((p) => selected.has(p.id));
    if (sel.length < 2) return null;
    const lat = meanStd(sel.map((p) => p.latitude));
    const lon = meanStd(sel.map((p) => p.longitude));
    const elev = meanStd(sel.map((p) => p.elevation));
    // СКО в метрах: разброс локальных смещений относительно среднего
    const offsets = sel.map((p) => toLocalMeters(lat.mean, lon.mean, p.latitude, p.longitude));
    const stdN = meanStd(offsets.map((o) => o.y)).std;
    const stdE = meanStd(offsets.map((o) => o.x)).std;
    return {
      count: sel.length,
      lat: lat.mean, lon: lon.mean, elev: elev.mean,
      stdN, stdE, stdH: elev.std,
    };
  }, [points, selected]);

  const saveAsPoint = async () => {
    if (!result || !project) return;
    const n = await countPoints(project.id);
    await addPoint({
      projectId: project.id,
      name: 'AVG' + String(n + 1).padStart(3, '0'),
      code: 'AVG',
      latitude: result.lat, longitude: result.lon, elevation: result.elev,
      quality: 'single',
      hAccuracy: Math.max(result.stdN, result.stdE),
      vAccuracy: result.stdH,
      epochs: result.count,
      note: `Осреднение ${result.count} точек`,
    });
    Alert.alert('Сохранено', 'Средняя точка добавлена в БД точек.');
    load();
  };

  if (!project) {
    return (
      <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={shared.muted}>Сначала выберите проект.</Text>
      </View>
    );
  }

  return (
    <View style={shared.container}>
      <FlatList
        data={points}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 260 }}
        ListHeaderComponent={
          <Text style={[shared.muted, { marginBottom: space.md }]}>
            Отметьте 2+ измерения одной точки — получите среднее и СКО.
          </Text>
        }
        ListEmptyComponent={
          <Text style={[shared.muted, { textAlign: 'center', paddingTop: 40 }]}>Точек пока нет.</Text>
        }
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable onPress={() => toggle(item.id)}>
              <Card style={StyleSheet.flatten([styles.row, on && styles.rowOn])}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24}
                  color={on ? colors.accent : colors.textMuted} />
                <View style={{ flex: 1, marginLeft: space.md }}>
                  <Text style={styles.name}>{item.name} {item.code ? `· ${item.code}` : ''}</Text>
                  <Text style={styles.coord}>
                    {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)} · H {item.elevation.toFixed(2)}
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />

      {result && (
        <View style={styles.resultBar}>
          <Text style={styles.resTitle}>Среднее из {result.count} точек</Text>
          <Text style={styles.resCoord}>
            {result.lat.toFixed(7)}, {result.lon.toFixed(7)} · H {result.elev.toFixed(3)} м
          </Text>
          <Text style={styles.resStd}>
            СКО: N ±{result.stdN.toFixed(3)} · E ±{result.stdE.toFixed(3)} · H ±{result.stdH.toFixed(3)} м
          </Text>
          <Button label="Сохранить как точку" onPress={saveAsPoint} style={{ marginTop: space.md }} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  rowOn: { borderColor: colors.accentDim },
  name: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700' },
  coord: { color: colors.textMuted, fontSize: font.caption, marginTop: 3, fontVariant: ['tabular-nums'] },
  resultBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: space.lg, backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.accentDim,
  },
  resTitle: { color: colors.accent, fontSize: font.small, fontWeight: '800', letterSpacing: 0.5 },
  resCoord: { color: colors.textPrimary, fontSize: font.body, fontWeight: '600', marginTop: 6, fontVariant: ['tabular-nums'] },
  resStd: { color: colors.textSecondary, fontSize: font.small, marginTop: 4, fontVariant: ['tabular-nums'] },
});
