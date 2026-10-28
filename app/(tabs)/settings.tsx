import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Card, Button } from '../../src/components/ui';
import { kvGet, kvSet } from '../../src/db/database';

/** Настройки съёмки: число эпох усреднения и порог точности. */
export default function SettingsScreen() {
  const [epochs, setEpochs] = useState('5');
  const [accLimit, setAccLimit] = useState('10');

  useFocusEffect(useCallback(() => {
    kvGet('avgEpochs').then((v) => v && setEpochs(v));
    kvGet('accLimit').then((v) => v && setAccLimit(v));
  }, []));

  const save = async () => {
    const e = Math.max(1, Math.min(60, parseInt(epochs, 10) || 5));
    const a = Math.max(0.01, Math.min(100, parseFloat(accLimit.replace(',', '.')) || 10));
    await kvSet('avgEpochs', String(e));
    await kvSet('accLimit', String(a));
    setEpochs(String(e));
    setAccLimit(String(a));
    Alert.alert('Сохранено', `Усреднение: ${e} эпох\nПорог точности: ${a} м`);
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <Card>
        <Text style={styles.cardTitle}>Съёмка</Text>
        <Text style={shared.label}>Эпох усреднения (1–60)</Text>
        <TextInput style={shared.input} value={epochs} onChangeText={setEpochs}
          keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
        <Text style={styles.hintText}>
          Сколько секундных измерений усредняется при съёмке точки.
        </Text>
        <Text style={shared.label}>Порог точности, м</Text>
        <TextInput style={shared.input} value={accLimit} onChangeText={setAccLimit}
          keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
        <Text style={styles.hintText}>
          Если точность хуже порога — приложение предупредит перед сохранением.
        </Text>
        <Button label="Сохранить" onPress={save} style={{ marginTop: space.lg }} />
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.cardTitle}>О приложении</Text>
        <Text style={styles.aboutRow}>GeoField Pro — прототип, Фаза 2</Text>
        <Text style={styles.aboutMuted}>Expo SDK 54 · SQLite офлайн · GPS телефона</Text>
        <Text style={styles.aboutMuted}>
          Подключение внешних GNSS-приёмников и карта — в Фазе 4 (нативная сборка).
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cardTitle: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '700', marginBottom: space.sm },
  hintText: { color: colors.textMuted, fontSize: font.caption, marginTop: 6, lineHeight: 16 },
  aboutRow: { color: colors.textPrimary, fontSize: font.body, marginTop: 4 },
  aboutMuted: { color: colors.textMuted, fontSize: font.small, marginTop: 6, lineHeight: 18 },
});
