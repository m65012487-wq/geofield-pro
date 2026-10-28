import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, font } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Button } from '../../src/components/ui';
import { parseNum } from '../../src/components/NumField';
import { polygonArea, polygonPerimeter } from '../../src/lib/cogo';

interface Row { n: string; e: string }

/** Площадь полигона по каталогу координат (формула Гаусса). */
export default function AreaScreen() {
  const [rows, setRows] = useState<Row[]>([
    { n: '', e: '' }, { n: '', e: '' }, { n: '', e: '' },
  ]);
  const [res, setRes] = useState<{ area: number; perim: number } | null>(null);
  const [err, setErr] = useState('');

  const setCell = (i: number, key: keyof Row, v: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  };

  const calc = () => {
    const pts = rows
      .map((r) => ({ n: parseNum(r.n), e: parseNum(r.e) }))
      .filter((p) => !Number.isNaN(p.n) && !Number.isNaN(p.e));
    if (pts.length < 3) { setErr('Нужно минимум 3 заполненные вершины.'); setRes(null); return; }
    setErr('');
    setRes({ area: polygonArea(pts), perim: polygonPerimeter(pts) });
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}
      keyboardShouldPersistTaps="handled">
      <Text style={shared.muted}>
        Введите вершины полигона по порядку обхода (каталог координат N/E).
      </Text>
      {rows.map((r, i) => (
        <View key={i} style={styles.row}>
          <Text style={styles.idx}>{i + 1}</Text>
          <TextInput style={[shared.input, { flex: 1 }]} value={r.n}
            onChangeText={(v) => setCell(i, 'n', v)} keyboardType="numbers-and-punctuation"
            placeholder="N, м" placeholderTextColor={colors.textMuted} />
          <TextInput style={[shared.input, { flex: 1 }]} value={r.e}
            onChangeText={(v) => setCell(i, 'e', v)} keyboardType="numbers-and-punctuation"
            placeholder="E, м" placeholderTextColor={colors.textMuted} />
          <Pressable onPress={() => setRows((p) => p.filter((_, idx) => idx !== i))}
            disabled={rows.length <= 3} style={{ opacity: rows.length <= 3 ? 0.3 : 1 }}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
          </Pressable>
        </View>
      ))}
      <Button label="+ Вершина" variant="secondary"
        onPress={() => setRows((p) => [...p, { n: '', e: '' }])} style={{ marginTop: space.md }} />
      <Button label="Вычислить" onPress={calc} style={{ marginTop: space.md }} />
      {!!err && <Text style={[shared.muted, { marginTop: space.md }]}>{err}</Text>}
      {res && (
        <View style={shared.resultBox}>
          <View>
            <Text style={shared.resultLabel}>Площадь</Text>
            <Text style={shared.resultValue}>{res.area.toFixed(2)} м²</Text>
            <Text style={[shared.muted, shared.mono]}>
              = {(res.area / 10000).toFixed(4)} га = {(res.area / 100).toFixed(2)} соток
            </Text>
          </View>
          <View>
            <Text style={shared.resultLabel}>Периметр</Text>
            <Text style={shared.resultValue}>{res.perim.toFixed(2)} м</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: 2 },
  idx: {
    color: colors.textMuted, fontSize: font.small, width: 20,
    textAlign: 'center', marginBottom: 18,
  },
});
