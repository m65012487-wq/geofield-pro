import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Modal, TextInput, Alert, Switch } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { ScreenHelp, HelpButton } from '../src/components/Help';
import { parseLineCodes, DEFAULT_LINE_GAP } from '../src/lib/codeLines';
import { listCodes, addCode, deleteCode, kvGet, kvSet } from '../src/db/database';
import { DEFAULT_CODE_EPOCHS } from '../src/lib/useShot';
import type { FeatureCode } from '../src/db/types';

const PALETTE = ['#B6F94B', '#4BC0F9', '#F9A64B', '#F94B7E', '#3DDC84', '#B08CFF', '#FFD24B', '#FF6B5C'];

/** Библиотека кодов объектов. Нажать код — сколько эпох усреднять для него, удержать — удалить. */
export default function CodesScreen() {
  const [codes, setCodes] = useState<FeatureCode[]>([]);
  const [modal, setModal] = useState(false);
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [epochs, setEpochs] = useState<Record<string, number>>(DEFAULT_CODE_EPOCHS);
  const [defEpochs, setDefEpochs] = useState(2);
  const [lineCodes, setLineCodes] = useState<string[]>([]);
  const [gap, setGap] = useState(String(DEFAULT_LINE_GAP));
  const [epEdit, setEpEdit] = useState<{ code: string; value: string } | null>(null);

  const load = useCallback(() => {
    listCodes().then(setCodes);
    kvGet('codeEpochs').then((v) => { if (v) try { setEpochs(JSON.parse(v)); } catch { /* по умолчанию */ } });
    kvGet('lineCodes').then((v) => setLineCodes(parseLineCodes(v)));
    kvGet('lineGap').then((v) => setGap(v || String(DEFAULT_LINE_GAP)));
    kvGet('avgEpochs').then((v) => v && setDefEpochs(parseInt(v, 10) || 2));
  }, []);

  const saveEpochs = async () => {
    if (!epEdit) return;
    const n = parseInt(epEdit.value, 10);
    const next = { ...epochs };
    if (n >= 1 && n <= 60) next[epEdit.code] = n; else delete next[epEdit.code];
    setEpochs(next);
    await kvSet('codeEpochs', JSON.stringify(next));
    setEpEdit(null);
  };
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleLine = async (c: string, on: boolean) => {
    const next = on ? [...lineCodes.filter((x) => x !== c), c] : lineCodes.filter((x) => x !== c);
    setLineCodes(next);
    await kvSet('lineCodes', next.join(','));
  };
  const saveGap = async (t: string) => {
    setGap(t);
    const g = parseFloat(t.replace(',', '.'));
    if (g > 0) await kvSet('lineGap', String(g));
  };

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
      <ScreenHelp title="Коды объектов" text={CODES_HELP} />
      <FlatList
        data={codes}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 110 }}
        ListHeaderComponent={
          <Card style={{ ...styles.row, marginBottom: space.lg }}>
            <Text style={[styles.desc, { fontSize: font.small }]}>Разрыв линии, если между точками больше, м</Text>
            <TextInput style={[shared.input, { width: 70, textAlign: 'center' }]} value={gap} onChangeText={saveGap}
              keyboardType="decimal-pad" />
            <HelpButton size={20} title="Разрыв линии"
              text="Точки кода с переключателем «линия» соединяются по порядку съёмки. Если следующая точка дальше предыдущей больше, чем это число метров, линия рвётся — так кромка не тянется через весь объект к другому участку." />
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onLongPress={() => confirmDelete(item)}
            onPress={() => setEpEdit({ code: item.code, value: epochs[item.code] ? String(epochs[item.code]) : '' })}>
            <Card style={styles.row}>
              <View style={[styles.dot, { backgroundColor: item.color }]} />
              <Text style={styles.code}>{item.code}</Text>
              <Text style={styles.desc} numberOfLines={1}>{item.description}</Text>
              <View style={styles.lineSw}>
                <Text style={styles.lineT}>линия</Text>
                <Switch value={lineCodes.includes(item.code)} onValueChange={(v) => toggleLine(item.code, v)} />
              </View>
              <Text style={[styles.ep, !epochs[item.code] && { color: colors.textMuted }]}>{epochs[item.code] ?? defEpochs} эп.</Text>
            </Card>
          </Pressable>
        )}
      />
      <View style={styles.fabBar}>
        <Button label="+ Новый код" onPress={() => setModal(true)} />
      </View>

      <Modal visible={epEdit != null} transparent animationType="fade" onRequestClose={() => setEpEdit(null)}>
        <View style={shared.modalOverlay}>
          <View style={shared.modalSheet}>
            <Text style={shared.modalTitle}>Эпох для {epEdit?.code}</Text>
            <TextInput style={shared.input} value={epEdit?.value ?? ''} keyboardType="number-pad" autoFocus
              onChangeText={(v) => setEpEdit((e) => (e ? { ...e, value: v } : e))}
              placeholder={`как в настройках (${defEpochs})`} placeholderTextColor={colors.textMuted} />
            <Text style={[shared.muted, { marginTop: space.sm }]}>
              1 эпоха FIX — быстро, для массовых точек. Съезды, реперы, контроль — 3 и больше. Пусто — как в настройках.
            </Text>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <Button label="Отмена" variant="secondary" onPress={() => setEpEdit(null)} style={{ flex: 1 }} />
              <Button label="Сохранить" onPress={saveEpochs} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

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

const CODES_HELP = [
  'Код — это вид объекта (дорога, кювет, опора). Из кодов на экране «Съёмка» строятся кнопки.',
  'Эпохи по коду: нажмите на код и введите, сколько эпох усреднять для него. 1 — быстро, для массовых точек; 3 и больше — для съездов, реперов, контроля. Пусто — как в настройках.',
  'Линия: включите переключатель «линия» у кода линейного объекта (кромка, бровка, кювет). Точки этого кода соединятся линией по порядку съёмки, цветом кода: на «Карте» (слой «Линии по коду») и в DXF при экспорте. Поле сверху — разрыв: если следующая точка дальше этого числа метров, линия рвётся.',
  'Удаление: удержите палец на коде и подтвердите. Новый код добавляет кнопка внизу.',
].join('\n\n');

const styles = StyleSheet.create({
  lineSw: { alignItems: 'center' },
  lineT: { color: colors.textMuted, fontSize: font.caption },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  dot: { width: 16, height: 16, borderRadius: 8 },
  code: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800', minWidth: 70 },
  desc: { color: colors.textSecondary, fontSize: font.body, flex: 1 },
  ep: { color: colors.textPrimary, fontSize: font.small, fontWeight: '800' },
  fabBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
  palette: { flexDirection: 'row', gap: space.md, marginTop: 4, flexWrap: 'wrap' },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: 'transparent' },
  swatchActive: { borderColor: '#FFFFFF' },
});
