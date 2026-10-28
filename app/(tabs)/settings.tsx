import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert, Switch } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Card, Button } from '../../src/components/ui';
import { kvGet, kvSet } from '../../src/db/database';

/** Настройки съёмки: число эпох усреднения и порог точности. */
export default function SettingsScreen() {
  const [epochs, setEpochs] = useState('2');
  const [accLimit, setAccLimit] = useState('0.05');
  const [tilt, setTilt] = useState(false);
  const [volKey, setVolKey] = useState(true);
  const [floatBtn, setFloatBtn] = useState(true);

  useFocusEffect(useCallback(() => {
    kvGet('avgEpochs').then((v) => v && setEpochs(v));
    kvGet('accLimit').then((v) => v && setAccLimit(v));
    kvGet('tiltByReceiver').then((v) => setTilt(v === '1'));
    kvGet('volumeShutter').then((v) => setVolKey(v !== '0'));
    kvGet('floatShutter').then((v) => setFloatBtn(v !== '0'));
  }, []));

  const save = async () => {
    const e = Math.max(1, Math.min(60, parseInt(epochs, 10) || 2));
    const a = Math.max(0.005, Math.min(100, parseFloat(accLimit.replace(',', '.')) || 0.05));
    await kvSet('avgEpochs', String(e));
    await kvSet('accLimit', String(a));
    await kvSet('tiltByReceiver', tilt ? '1' : '0');
    await kvSet('volumeShutter', volKey ? '1' : '0');
    await kvSet('floatShutter', floatBtn ? '1' : '0');
    setEpochs(String(e));
    setAccLimit(String(a));
    Alert.alert('Сохранено', `Эпох на точку: ${e}\nДопуск σ: ${a} м\nВеха: ${tilt ? 'учитывает приёмник' : 'вычитает программа'}`);
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <Card>
        <Text style={styles.cardTitle}>Съёмка</Text>
        <Text style={shared.label}>Эпох на точку (1–60)</Text>
        <TextInput style={shared.input} value={epochs} onChangeText={setEpochs}
          keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
        <Text style={styles.hintText}>
          Сколько эпох приёмника усредняется. eFix C5 сейчас шлёт эпоху раз в 5 с: 2 эпохи ≈ 10 с на точку.
        </Text>
        <Text style={shared.label}>Допуск σ в плане, м</Text>
        <TextInput style={shared.input} value={accLimit} onChangeText={setAccLimit}
          keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
        <Text style={styles.hintText}>
          Если точность хуже порога — приложение предупредит перед сохранением.
        </Text>
        <View style={styles.switchRow}>
          <Text style={[shared.label, { flex: 1, marginTop: 0 }]}>Наклон и веху учитывает приёмник</Text>
          <Switch value={tilt} onValueChange={setTilt} />
        </View>
        <Text style={styles.hintText}>
          Включить, если приёмник сам компенсирует наклон (IMU) и в нём задана высота вехи — тогда координаты
          уже на острие вехи и программа веху не вычитает. Выключено — вешку держать по уровню, высота вехи
          вычитается программой. Проверка: острие на месте, наклонить вешку на 20–30° — если координаты почти
          не меняются, компенсация работает.
        </Text>
        <View style={styles.switchRow}>
          <Text style={[shared.label, { flex: 1, marginTop: 0 }]}>Клавиша «громкость −» снимает точку</Text>
          <Switch value={volKey} onValueChange={setVolKey} />
        </View>
        <Text style={styles.hintText}>
          На экранах «Съёмка» и «Карта» (Android): снимает текущий объект, повторное нажатие во время
          измерения — отмена. На других экранах клавиша работает как обычно.
        </Text>
        <View style={styles.switchRow}>
          <Text style={[shared.label, { flex: 1, marginTop: 0 }]}>Плавающая кнопка «Измерить»</Text>
          <Switch value={floatBtn} onValueChange={setFloatBtn} />
        </View>
        <Text style={styles.hintText}>
          Круглая кнопка поверх «Съёмки» и «Карты»: нажать — снять, потащить пальцем — переставить в удобное место.
        </Text>
        <Button label="Сохранить" onPress={save} style={{ marginTop: space.lg }} />
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.cardTitle}>О приложении</Text>
        <Text style={styles.aboutRow}>GeoField Pro</Text>
        <Text style={styles.aboutMuted}>Приёмник по Bluetooth (NMEA) · калибровка по реперам · подложка DXF · SQLite офлайн</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cardTitle: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '700', marginBottom: space.sm },
  hintText: { color: colors.textMuted, fontSize: font.caption, marginTop: 6, lineHeight: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg },
  aboutRow: { color: colors.textPrimary, fontSize: font.body, marginTop: 4 },
  aboutMuted: { color: colors.textMuted, fontSize: font.small, marginTop: 6, lineHeight: 18 },
});
