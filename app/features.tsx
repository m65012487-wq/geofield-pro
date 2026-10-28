import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Card } from '../src/components/ui';
import { useActiveProject } from '../src/lib/useActiveProject';
import { listFeatures, deleteFeature } from '../src/db/database';
import { geoLength, geoArea, geoPerimeter } from '../src/lib/geo';
import type { Feature } from '../src/db/types';

/** Список линий и полигонов с геометрией: длина / площадь / периметр. */
export default function FeaturesScreen() {
  const { project } = useActiveProject();
  const [features, setFeatures] = useState<Feature[]>([]);

  const load = useCallback(() => {
    if (!project) return;
    listFeatures(project.id).then(setFeatures);
  }, [project?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmDelete = (f: Feature) => {
    Alert.alert('Удалить объект?', `«${f.name}» будет удалён.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive',
        onPress: async () => { await deleteFeature(f.id, project!.id); load(); } },
    ]);
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
        data={features}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{ padding: space.lg }}
        ListEmptyComponent={
          <Text style={[shared.muted, { textAlign: 'center', paddingTop: 40 }]}>
            Объектов пока нет. Снимите линию или полигон на вкладке «Работа».
          </Text>
        }
        renderItem={({ item }) => {
          const isPoly = item.type === 'polygon';
          const geomText = isPoly
            ? `S = ${geoArea(item.vertices).toFixed(1)} м² · P = ${geoPerimeter(item.vertices).toFixed(1)} м`
            : `L = ${geoLength(item.vertices).toFixed(1)} м`;
          return (
            <Pressable onLongPress={() => confirmDelete(item)}>
              <Card style={styles.row}>
                <Ionicons name={isPoly ? 'shapes' : 'analytics'} size={26}
                  color={isPoly ? colors.accent : colors.float} />
                <View style={{ flex: 1, marginLeft: space.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                    <Text style={styles.name}>{item.name}</Text>
                    {!!item.code && <Text style={styles.code}>{item.code}</Text>}
                  </View>
                  <Text style={styles.geom}>{geomText}</Text>
                  <Text style={styles.meta}>{item.vertices.length} вершин · удерживайте для удаления</Text>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  name: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '700' },
  code: { color: colors.accent, fontSize: font.small, fontWeight: '600' },
  geom: { color: colors.textSecondary, fontSize: font.small, marginTop: 4, fontVariant: ['tabular-nums'] },
  meta: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
});
