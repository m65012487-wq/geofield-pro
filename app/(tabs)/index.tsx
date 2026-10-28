import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Modal, TextInput, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, font } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Button, Card } from '../../src/components/ui';
import { listProjects, createProject, deleteProject, kvGet } from '../../src/db/database';
import { setActiveProject } from '../../src/lib/useActiveProject';
import type { Project } from '../../src/db/types';

export default function ProjectsScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [crs, setCrs] = useState('WGS84 / UTM 37N');

  const load = useCallback(() => {
    listProjects().then(setProjects);
    kvGet('activeProjectId').then(setActiveId);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openProject = async (p: Project) => {
    await setActiveProject(p.id);
    router.push('/(tabs)/work');
  };

  const handleCreate = async () => {
    if (!name.trim()) { Alert.alert('Введите название проекта'); return; }
    const p = await createProject(name.trim(), desc.trim(), crs.trim() || 'WGS84');
    setModal(false); setName(''); setDesc('');
    await openProject(p);
  };

  const confirmDelete = (p: Project) => {
    Alert.alert('Удалить проект?', `«${p.name}» и все его данные будут удалены.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive',
        onPress: async () => { await deleteProject(p.id); load(); } },
    ]);
  };

  return (
    <View style={shared.container}>
      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Пока нет проектов</Text>
            <Text style={styles.emptyText}>Создайте первый проект, чтобы начать съёмку.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const active = item.id === activeId;
          return (
            <Pressable onPress={() => openProject(item)} onLongPress={() => confirmDelete(item)}>
              <Card style={StyleSheet.flatten([styles.projectCard, active && styles.projectActive])}>
                <View style={{ flex: 1 }}>
                  <View style={shared.row}>
                    <Text style={styles.projectName}>{item.name}</Text>
                    {active && <Text style={styles.activeBadge}>АКТИВНЫЙ</Text>}
                  </View>
                  {!!item.description && (
                    <Text style={styles.projectDesc} numberOfLines={1}>{item.description}</Text>
                  )}
                  <Text style={styles.projectMeta}>{item.crs} · {item.pointCount ?? 0} точек</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
              </Card>
            </Pressable>
          );
        }}
      />
      <View style={styles.fabBar}>
        <Button label="+ Новый проект" onPress={() => setModal(true)} />
      </View>

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={shared.modalOverlay}>
          <View style={shared.modalSheet}>
            <Text style={shared.modalTitle}>Новый проект</Text>
            <Text style={shared.label}>Название</Text>
            <TextInput style={shared.input} value={name} onChangeText={setName}
              placeholder="Участок №1" placeholderTextColor={colors.textMuted} autoFocus />
            <Text style={shared.label}>Описание</Text>
            <TextInput style={shared.input} value={desc} onChangeText={setDesc}
              placeholder="Кадастровая съёмка" placeholderTextColor={colors.textMuted} />
            <Text style={shared.label}>Система координат</Text>
            <TextInput style={shared.input} value={crs} onChangeText={setCrs}
              placeholderTextColor={colors.textMuted} />
            <View style={styles.modalActions}>
              <Button label="Отмена" variant="secondary" onPress={() => setModal(false)} style={{ flex: 1 }} />
              <Button label="Создать" onPress={handleCreate} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  projectCard: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  projectActive: { borderColor: colors.accentDim },
  projectName: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '700' },
  activeBadge: {
    color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.5,
    marginLeft: space.sm, borderWidth: 1, borderColor: colors.accentDim,
    borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden',
  },
  projectDesc: { color: colors.textSecondary, fontSize: font.body, marginTop: 2 },
  projectMeta: { color: colors.textMuted, fontSize: font.small, marginTop: 6 },
  empty: { alignItems: 'center', paddingTop: 80, gap: space.sm },
  emptyTitle: { color: colors.textPrimary, fontSize: font.title, fontWeight: '700' },
  emptyText: { color: colors.textSecondary, fontSize: font.body, textAlign: 'center', paddingHorizontal: 40 },
  fabBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
  modalActions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
});
