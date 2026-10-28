import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput, Alert, Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card, QualityBadge } from '../src/components/ui';
import { useActiveProject } from '../src/lib/useActiveProject';
import { listPoints, deletePoint, updatePoint } from '../src/db/database';
import type { SurveyPoint } from '../src/db/types';

/** БД точек: поиск, правка, вынос, удаление. mode=stakeout — режим выбора цели. */
export default function PointsScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const stakeoutMode = mode === 'stakeout';
  const { project } = useActiveProject();

  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SurveyPoint | null>(null);
  const [eName, setEName] = useState('');
  const [eCode, setECode] = useState('');
  const [eNote, setENote] = useState('');

  const load = useCallback(() => {
    if (!project) return;
    listPoints(project.id, search).then(setPoints);
  }, [project?.id, search]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRowPress = (p: SurveyPoint) => {
    if (stakeoutMode) {
      router.push({ pathname: '/stakeout', params: { pointId: p.id } });
      return;
    }
    Alert.alert(p.name, p.code || 'без кода', [
      { text: 'Вынос', onPress: () => router.push({ pathname: '/stakeout', params: { pointId: p.id } }) },
      { text: 'Редактировать', onPress: () => {
          setEName(p.name); setECode(p.code); setENote(p.note); setEditing(p);
        } },
      { text: 'Удалить', style: 'destructive', onPress: () => {
          Alert.alert('Удалить точку?', `«${p.name}» будет удалена.`, [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Удалить', style: 'destructive',
              onPress: async () => { await deletePoint(p.id, project!.id); load(); } },
          ]);
        } },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  const saveEdit = async () => {
    if (!editing) return;
    await updatePoint(editing.id, { name: eName.trim(), code: eCode.trim(), note: eNote.trim() });
    setEditing(null);
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
      <Stack.Screen options={{ title: stakeoutMode ? 'Вынос: выбор точки' : 'БД точек' }} />
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск по имени или коду…"
          placeholderTextColor={colors.textMuted}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {stakeoutMode && (
        <Text style={styles.stakeHint}>Выберите точку — откроется навигация выноса.</Text>
      )}

      <FlatList
        data={points}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: space.lg, paddingTop: space.sm }}
        ListEmptyComponent={
          <Text style={[shared.muted, { textAlign: 'center', paddingTop: 40 }]}>
            {search ? 'Ничего не найдено.' : 'Точек пока нет.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => onRowPress(item)}>
            <Card style={styles.row}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                  <Text style={styles.name}>{item.name}</Text>
                  {!!item.code && <Text style={styles.code}>{item.code}</Text>}
                </View>
                <Text style={styles.coord}>
                  {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}
                </Text>
                <Text style={styles.meta}>
                  H {item.elevation.toFixed(2)} м · ±{item.hAccuracy.toFixed(2)} м · {item.epochs} эп.
                </Text>
              </View>
              <QualityBadge quality={item.quality} />
            </Card>
          </Pressable>
        )}
      />

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={shared.modalOverlay}>
          <View style={shared.modalSheet}>
            <Text style={shared.modalTitle}>Редактирование</Text>
            <Text style={shared.label}>Имя</Text>
            <TextInput style={shared.input} value={eName} onChangeText={setEName}
              placeholderTextColor={colors.textMuted} />
            <Text style={shared.label}>Код</Text>
            <TextInput style={shared.input} value={eCode} onChangeText={setECode}
              placeholderTextColor={colors.textMuted} />
            <Text style={shared.label}>Примечание</Text>
            <TextInput style={shared.input} value={eNote} onChangeText={setENote}
              placeholderTextColor={colors.textMuted} />
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <Button label="Отмена" variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
              <Button label="Сохранить" onPress={saveEdit} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginTop: space.md,
    backgroundColor: colors.surfaceRaised, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: font.body, minHeight: 46 },
  stakeHint: { color: colors.accent, fontSize: font.small, paddingHorizontal: space.lg, paddingTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  name: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '700' },
  code: { color: colors.accent, fontSize: font.small, fontWeight: '600' },
  coord: { color: colors.textSecondary, fontSize: font.small, marginTop: 4, fontVariant: ['tabular-nums'] },
  meta: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
});
