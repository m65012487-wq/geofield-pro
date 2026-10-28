import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Modal, TextInput, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { listCodes, addCode, deleteCode } from '../src/db/database';
import type { FeatureCode } from '../src/db/types';

const PALETTE = ['#B6F94B', '#4BC0F9', '#F9A64B', '#F94B7E', '#3DDC84', '#B08CFF', '#FFD24B', '#FF6B5C'];

/** Библиотека кодов объектов. */
export default function CodesScreen() {
  const [codes, setCodes] = useState<FeatureCode[]>([]);
  const [modal, setModal] = useState(false);
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [color, setColor] = useState(PALETTE[0]);

  const load = useCallback(() => { listCodes().then(setCodes); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAdd = async () => {
    if (!code.trim()) { Alert.alert('Введите код'); return; }
    await addCode(code.trim().toUpperCase(), desc.trim(), color);
    setModal(false); setCode(''); setDesc('');
    load();
  };

  const confirmDelete = (c: FeatureCode) => {
    Alert.alert('Удалить код?', `«${c.code}» будет удалён из библиотеки.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive',
        onPress: async () => { await deleteCode(c.id); load(); } },
    ]);
  };

  return (
    <View style={shared.container}>
      <FlatList
        data={codes}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 110 }}
        renderItem={({ item }) => (
          <Pressable onLongPress={() => confirmDelete(item)}>
            <Card style={styles.row}>
              <View style={[styles.dot, { backgroundColor: item.color }]} />
              <Text style={styles.code}>{item.code}</Text>
              <Text style={styles.desc} numberOfLines={1}>{item.description}</Text>
            </Card>
          </Pressable>
        )}
      />
      <View style={styles.fabBar}>
        <Button label="+ Новый код" onPress={() => setModal(true)} />
      </View>

      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <View style={shared.modalOverlay}>
          <View style={shared.modalSheet}>
            <Text style={shared.modalTitle}>Новый код</Text>
            <Text style={shared.label}>Код (короткий)</Text>
            <TextInput style={shared.input} value={code} onChangeText={setCode}
              placeholder="ЛЭП" autoCapitalize="characters" placeholderTextColor={colors.textMuted} />
            <Text style={shared.label}>Описание</Text>
            <TextInput style={shared.input} value={desc} onChangeText={setDesc}
              placeholder="Опора ЛЭП" placeholderTextColor={colors.textMuted} />
            <Text style={shared.label}>Цвет</Text>
            <View style={styles.palette}>
              {PALETTE.map((c) => (
                <Pressable key={c} onPress={() => setColor(c)}
                  style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <Button label="Отмена" variant="secondary" onPress={() => setModal(false)} style={{ flex: 1 }} />
              <Button label="Добавить" onPress={handleAdd} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  dot: { width: 16, height: 16, borderRadius: 8 },
  code: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800', minWidth: 70 },
  desc: { color: colors.textSecondary, fontSize: font.body, flex: 1 },
  fabBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
  palette: { flexDirection: 'row', gap: space.md, marginTop: 4, flexWrap: 'wrap' },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: 'transparent' },
  swatchActive: { borderColor: '#FFFFFF' },
});
