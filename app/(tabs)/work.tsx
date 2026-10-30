import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors, space, font } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Tile } from '../../src/components/Tile';
import { Button } from '../../src/components/ui';
import { useActiveProject } from '../../src/lib/useActiveProject';
import { countPoints, countFeatures } from '../../src/db/database';
import { ScreenHelp } from '../../src/components/Help';
import { maybeAutoBackup } from '../../src/lib/backup';
import { HELP } from '../../src/lib/helpTexts';

const T = HELP.tiles;

export default function WorkScreen() {
  const router = useRouter();
  const { project } = useActiveProject();
  const [nPoints, setNPoints] = useState(0);
  const [nLines, setNLines] = useState(0);
  const [nPolys, setNPolys] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!project) return;
    countPoints(project.id).then(setNPoints);
    countFeatures(project.id, 'line').then(setNLines);
    countFeatures(project.id, 'polygon').then(setNPolys);
    maybeAutoBackup(project.id); // раз в день, тихо, если включено и есть бот
  }, [project?.id]));

  if (!project) {
    return (
      <View style={[shared.container, styles.center]}>
        <Text style={styles.noProject}>Проект не выбран</Text>
        <Text style={shared.muted}>Откройте или создайте проект на вкладке «Проект».</Text>
        <Button label="К проектам" variant="secondary"
          onPress={() => router.push('/(tabs)')} style={{ marginTop: space.lg, minWidth: 200 }} />
      </View>
    );
  }

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <View style={styles.projectBanner}>
        <Text style={styles.projectLabel}>АКТИВНЫЙ ПРОЕКТ</Text>
        <Text style={styles.projectName}>{project.name}</Text>
        <Text style={styles.projectCrs}>{project.crs}</Text>
      </View>

      <ScreenHelp title="Работа" text={HELP.work} />
      <Text style={styles.groupTitle}>Съёмка</Text>
      <View style={styles.grid}>
        <Tile label="Карта" icon="map-outline" help={T.map} onPress={() => router.push('/map')} />
        <Tile label="Приёмник" icon="bluetooth" help={T.receiver} onPress={() => router.push('/receiver')} />
        <Tile label="NTRIP" icon="cloud-download-outline" help={T.ntrip} onPress={() => router.push('/ntrip')} />
        <Tile label="Калибровка" icon="locate" help={T.calibration} onPress={() => router.push('/calibration')} />
        <Tile label="Контроль на репере" icon="checkmark-done-circle-outline" help={T.basecheck} onPress={() => router.push('/basecheck')} />
        <Tile label="Подложка DXF" icon="map" help={T.basemap} onPress={() => router.push('/basemap')} />
        <Tile label="Съёмка точек" icon="pin" badge={String(nPoints)} help={T.survey}
          onPress={() => router.push('/survey')} />
        <Tile label="Съёмка линии" icon="analytics" badge={String(nLines)} help={T.line}
          onPress={() => router.push({ pathname: '/survey-feature', params: { type: 'line' } })} />
        <Tile label="Съёмка полигона" icon="shapes" badge={String(nPolys)} help={T.polygon}
          onPress={() => router.push({ pathname: '/survey-feature', params: { type: 'polygon' } })} />
      </View>

      <Text style={styles.groupTitle}>Дорога</Text>
      <View style={styles.grid}>
        <Tile label="Трасса" icon="trail-sign" help={T.road} onPress={() => router.push('/road')} />
        <Tile label="Ведомость" icon="list" help={T.vedomost} onPress={() => router.push('/vedomost')} />
        <Tile label="Вынос сечения / DXF" icon="locate-outline" help="Выбор оси, кромки и бровки на пикете; вынос нижнего слоя; контроль откоса; привязки к линиям DXF. Подробная инструкция — кнопка ? внутри." onPress={() => router.push('/road-guide')} />
        <Tile label="Разбивка по оси" icon="git-commit-outline" help={T.roadStake} onPress={() => router.push('/road-stake')} />
      </View>

      <Text style={styles.groupTitle}>Инструменты</Text>
      <View style={styles.grid}>
        <Tile label="Труба" icon="water-outline" help={T.pipe} onPress={() => router.push('/pipe')} />
        <Tile label="Площадь и материалы" icon="square-outline" help={T.area} onPress={() => router.push('/area')} />
        <Tile label="Объём по поверхности" icon="cube-outline" help={T.tin} onPress={() => router.push('/tin')} />
        <Tile label="Вынос точек" icon="flag" help={T.stakeout}
          onPress={() => router.push({ pathname: '/points', params: { mode: 'stakeout' } })} />
      </View>

      <Text style={styles.groupTitle}>Данные</Text>
      <View style={styles.grid}>
        <Tile label="БД точек" icon="server" help={T.points} onPress={() => router.push('/points')} />
        <Tile label="Линии и полигоны" icon="git-branch" help={T.features} onPress={() => router.push('/features')} />
        <Tile label="Коды" icon="pricetags" help={T.codes} onPress={() => router.push('/codes')} />
        <Tile label="Экспорт" icon="share-outline" help={T.export} onPress={() => router.push('/export')} />
        <Tile label="Журнал дня" icon="calendar-outline" help={T.journal} onPress={() => router.push('/journal')} />
        <Tile label="Копия и обмен" icon="sync-outline" help={T.backup} onPress={() => router.push('/backup')} />
      </View>
      <Text style={styles.tip}>Удержите плитку — подсказка, что она делает.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  noProject: { color: colors.textPrimary, fontSize: font.title, fontWeight: '700', marginBottom: space.sm },
  projectBanner: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.accentDim,
    padding: space.lg, marginBottom: space.xl,
  },
  projectLabel: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  projectName: { color: colors.textPrimary, fontSize: font.title, fontWeight: '800', marginTop: 4 },
  projectCrs: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  groupTitle: {
    color: colors.textSecondary, fontSize: font.small, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: space.md,
  },
  tip: { color: colors.textMuted, fontSize: font.caption, textAlign: 'center', marginBottom: space.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
});
