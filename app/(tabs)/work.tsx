import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors, space, font } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Tile } from '../../src/components/Tile';
import { Button } from '../../src/components/ui';
import { useActiveProject } from '../../src/lib/useActiveProject';
import { countPoints, countFeatures } from '../../src/db/database';

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

      <Text style={styles.groupTitle}>Съёмка</Text>
      <View style={styles.grid}>
        <Tile label="Съёмка точек" icon="pin" badge={String(nPoints)}
          onPress={() => router.push('/survey')} />
        <Tile label="Съёмка линии" icon="analytics" badge={String(nLines)}
          onPress={() => router.push({ pathname: '/survey-feature', params: { type: 'line' } })} />
        <Tile label="Съёмка полигона" icon="shapes" badge={String(nPolys)}
          onPress={() => router.push({ pathname: '/survey-feature', params: { type: 'polygon' } })} />
      </View>

      <Text style={styles.groupTitle}>Вынос</Text>
      <View style={styles.grid}>
        <Tile label="Вынос точек" icon="flag"
          onPress={() => router.push({ pathname: '/points', params: { mode: 'stakeout' } })} />
      </View>

      <Text style={styles.groupTitle}>Данные</Text>
      <View style={styles.grid}>
        <Tile label="БД точек" icon="server" onPress={() => router.push('/points')} />
        <Tile label="Линии и полигоны" icon="git-branch" onPress={() => router.push('/features')} />
        <Tile label="Коды" icon="pricetags" onPress={() => router.push('/codes')} />
        <Tile label="Экспорт" icon="share-outline" onPress={() => router.push('/export')} />
      </View>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
});
