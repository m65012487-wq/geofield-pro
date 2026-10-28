import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { File } from 'expo-file-system';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button } from '../src/components/ui';
import { useActiveProject } from '../src/lib/useActiveProject';
import { listKnown, replaceKnown } from '../src/db/database';
import { fileTitle } from '../src/lib/basemap';
import { parseKnown } from '../src/lib/importKnown';
import type { KnownPoint } from '../src/db/types';

/** Реперы проекта: импорт каталога из файла (txt/csv «имя,N,E,H» или LandXML) и просмотр. */
export default function KnownScreen() {
  const { project } = useActiveProject();
  const [items, setItems] = useState<KnownPoint[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback((q = search) => {
    if (project) listKnown(project.id, q).then(setItems);
  }, [project?.id, search]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const importFile = async () => {
    if (!project) return;
    try {
      const picked = await File.pickFileAsync();
      const file = Array.isArray(picked) ? picked[0] : picked;
      if (!file) return;
      setBusy(true);
      const { points, skipped } = parseKnown(await file.text());
      if (points.length === 0) { Alert.alert('Пусто', 'В файле не найдено ни одного пункта «имя N E H».'); return; }
      Alert.alert('Импорт реперов',
        `${fileTitle(file.uri, "Файл")}: ${points.length} пунктов${skipped ? `, пропущено строк: ${skipped}` : ''}.\nТекущий список проекта будет заменён.`, [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Заменить', onPress: async () => { await replaceKnown(project.id, points); load(); } },
        ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) Alert.alert('Не удалось открыть файл', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={shared.container}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Button label="Импорт из файла (txt, csv, LandXML)" onPress={importFile} loading={busy} />
        <TextInput style={shared.input} value={search} placeholder="Поиск" placeholderTextColor={colors.textMuted}
          onChangeText={(t) => { setSearch(t); load(t); }} />
        <Text style={shared.muted}>Пунктов: {items.length}{search ? ' (по фильтру)' : ''}</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(k) => k.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>N {item.north.toFixed(3)}  E {item.east.toFixed(3)}  H {item.height.toFixed(3)}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { color: colors.textPrimary, fontSize: font.body, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: font.caption, fontVariant: ['tabular-nums'] },
});
