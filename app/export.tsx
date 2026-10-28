import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { useActiveProject } from '../src/lib/useActiveProject';
import { listPoints, listFeatures, kvGet, listCodes } from '../src/db/database';
import { exportPointsCsv, exportGeoJson, exportLocalTxt, writeCacheFile, shareFile, sanitizeName } from '../src/lib/exporter';
import { ScreenHelp } from '../src/components/Help';
import { surveyDxf } from '../src/lib/surveyDxf';
import { parseLineCodes, DEFAULT_LINE_GAP } from '../src/lib/codeLines';
import { sendDay } from '../src/lib/roadExport';
import { loadRoad } from '../src/lib/road';
import { loadRoadSettings } from '../src/lib/roadCheck';
import { loadShotSettings } from '../src/lib/useShot';
import type { SurveyPoint, Feature } from '../src/db/types';

/** Экспорт проекта: CSV точек и GeoJSON (точки + линии + полигоны). */
export default function ExportScreen() {
  const { project } = useActiveProject();
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [busy, setBusy] = useState<'csv' | 'geojson' | 'txt' | 'day' | 'dxf' | null>(null);

  const day = async () => {
    if (!project) return;
    setBusy('day');
    try {
      const [road, set, shot, codes, vc] = await Promise.all([
        loadRoad(project.id), loadRoadSettings(), loadShotSettings(), listCodes(), kvGet('volCodes')]);
      const msg = await sendDay(project, points, road, codes, shot.seq, set, vc ? vc.split(',') : ['OTK', 'KUV', 'OBL', 'OBP']);
      Alert.alert('Отправлено', msg);
    } catch (e) {
      Alert.alert('Не получилось', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const dxf = async () => {
    if (!project) return;
    setBusy('dxf');
    try {
      const [codes, lc, lg] = await Promise.all([listCodes(), kvGet('lineCodes'), kvGet('lineGap')]);
      const gap = parseFloat(lg ?? '');
      const { text, count } = surveyDxf(points, codes, parseLineCodes(lc), gap > 0 ? gap : DEFAULT_LINE_GAP);
      if (!count) throw new Error('Нет точек с местными координатами — сначала калибровка');
      const name = `${sanitizeName(project.name)}_съёмка.dxf`;
      await shareFile(writeCacheFile(name, text), 'application/dxf', name);
    } catch (e) {
      Alert.alert('Ошибка экспорта', e instanceof Error ? e.message : 'Неизвестная ошибка');
    } finally {
      setBusy(null);
    }
  };

  const load = useCallback(() => {
    if (!project) return;
    listPoints(project.id).then(setPoints);
    listFeatures(project.id).then(setFeatures);
  }, [project?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (kind: 'csv' | 'geojson' | 'txt') => {
    if (!project) return;
    if (kind !== 'geojson' && points.length === 0) {
      Alert.alert('Нет данных', 'В проекте нет точек для экспорта.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'txt') await exportLocalTxt(project, points);
      else if (kind === 'csv') await exportPointsCsv(project, points);
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
      <ScreenHelp title="Экспорт" text={EXPORT_HELP} />
      <Card>
        <Text style={styles.title}>{project.name}</Text>
        <Text style={styles.stats}>
          {points.length} точек · {nLines} линий · {nPolys} полигонов
        </Text>
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.fmtTitle}>За сегодня — одной кнопкой</Text>
        <Text style={styles.fmtDesc}>
          Точки за день: каталог NEH, ведомость по пикетам и схема DXF (если загружена трасса). С ботом из настроек
          уходят прямо в Telegram, без бота — через «Поделиться».
        </Text>
        <Button label="Отправить за сегодня ➤" onPress={day} loading={busy === 'day'} style={{ marginTop: space.md }} />
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.fmtTitle}>TXT — каталог N, E, H (МСК)</Text>
        <Text style={styles.fmtDesc}>
          Строки «имя,N,E,H,код» в местной системе по калибровке — как выгрузки съёмки для AutoCAD и скриптов.
        </Text>
        <Button label="Экспорт каталога" onPress={() => run('txt')} loading={busy === 'txt'}
          style={{ marginTop: space.md }} />
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.fmtTitle}>DXF — съёмка с линиями</Text>
        <Text style={styles.fmtDesc}>
          Вся съёмка для AutoCAD: точки с подписью имени и высоты по слоям кодов и линии по коду (кромки, бровки —
          включаются в «Кодах»). Координаты местные, по калибровке.
        </Text>
        <Button label="Экспорт DXF" onPress={dxf} loading={busy === 'dxf'} style={{ marginTop: space.md }} />
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.fmtTitle}>CSV — точки</Text>
        <Text style={styles.fmtDesc}>
          Таблица: имя, код, N/E/H местные, широта, долгота, высота, точность, качество. Открывается в Excel, AutoCAD, Credo.
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

const EXPORT_HELP = [
  'Выберите формат и нажмите кнопку — откроется меню «Поделиться»: сохраните файл, отправьте в Telegram, на почту или в облако.',
  'За сегодня — одной кнопкой: точки дня (каталог NEH), ведомость по пикетам и схема DXF по трассе. С ботом из настроек уходит прямо в Telegram.',
  'TXT (имя,N,E,H,код) — каталог для AutoCAD и скриптов.',
  'DXF — съёмка с линиями: чертёж для AutoCAD с точками по слоям кодов и линиями кромок/бровок.',
  'CSV — таблица для Excel, AutoCAD, Credo.',
  'GeoJSON — точки, линии и полигоны для QGIS, ArcGIS и карт.',
  'TXT, DXF и местные координаты в CSV требуют калибровки проекта.',
].join('\n\n');

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, fontSize: font.title, fontWeight: '800' },
  stats: { color: colors.textMuted, fontSize: font.small, marginTop: 4 },
  fmtTitle: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '700' },
  fmtDesc: { color: colors.textSecondary, fontSize: font.small, marginTop: 6, lineHeight: 19 },
});
