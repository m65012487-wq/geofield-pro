import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { useActiveProject } from '../src/lib/useActiveProject';
import { listPoints, listFeatures } from '../src/db/database';
import { exportPointsCsv, exportGeoJson } from '../src/lib/exporter';
import type { SurveyPoint, Feature } from '../src/db/types';

/** Экспорт проекта: CSV точек и GeoJSON (точки + линии + полигоны). */
export default function ExportScreen() {
  const { project } = useActiveProject();
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [busy, setBusy] = useState<'csv' | 'geojson' | null>(null);

  const load = useCallback(() => {
    if (!project) return;
    listPoints(project.id).then(setPoints);
    listFeatures(project.id).then(setFeatures);
  }, [project?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (kind: 'csv' | 'geojson') => {
    if (!project) return;
    if (kind === 'csv' && points.length === 0) {
      Alert.alert('Нет данных', 'В проекте нет точек для экспорта.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'csv') await exportPointsCsv(project, points);
      else await exportGeoJson(project, points, features);
    } catch (e) {
      Alert.alert('Ошибка экспорта', e instanceof Error ? e.message : 'Неизвестная ошибка');
    } finally {
      setBusy(null);
    }
  };

  if (!project) {
    return (
      <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={shared.muted}>Сначала выберите проект.</Text>
      </View>
    );
  }

  const nLines = features.filter((f) => f.type === 'line').length;
  const nPolys = features.filter((f) => f.type === 'polygon').length;

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <Card>
        <Text style={styles.title}>{project.name}</Text>
        <Text style={styles.stats}>
          {points.length} точек · {nLines} линий · {nPolys} полигонов
        </Text>
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.fmtTitle}>CSV — точки</Text>
        <Text style={styles.fmtDesc}>
          Таблица: имя, код, широта, долгота, высота, точность, качество. Открывается в Excel, AutoCAD, Credo.
        </Text>
        <Button label="Экспорт CSV" onPress={() => run('csv')} loading={busy === 'csv'}
          style={{ marginTop: space.md }} />
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.fmtTitle}>GeoJSON — весь проект</Text>
        <Text style={styles.fmtDesc}>
          Точки, линии и полигоны с атрибутами. Открывается в QGIS, ArcGIS, Google Earth (через конвертер).
        </Text>
        <Button label="Экспорт GeoJSON" onPress={() => run('geojson')} loading={busy === 'geojson'}
          style={{ marginTop: space.md }} />
      </Card>

      <Text style={[shared.muted, { marginTop: space.lg, lineHeight: 19 }]}>
        Файл откроется в системном меню «Поделиться»: сохраните на устройство, отправьте в Telegram, на почту или в облако.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, fontSize: font.title, fontWeight: '800' },
  stats: { color: colors.textMuted, fontSize: font.small, marginTop: 4 },
  fmtTitle: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '700' },
  fmtDesc: { color: colors.textSecondary, fontSize: font.small, marginTop: 6, lineHeight: 19 },
});
