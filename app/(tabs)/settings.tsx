import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert, Switch } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Card, Button } from '../../src/components/ui';
import { kvGet, kvSet } from '../../src/db/database';
import { DEFAULT_SEQ } from '../../src/lib/useShot';

/** Настройки съёмки: число эпох усреднения и порог точности. */
export default function SettingsScreen() {
  const [epochs, setEpochs] = useState('2');
  const [accLimit, setAccLimit] = useState('0.05');
  const [tilt, setTilt] = useState(false);
  const [volKey, setVolKey] = useState(true);
  const [floatBtn, setFloatBtn] = useState(true);
  const [voice, setVoice] = useState(true);
  const [waitFix, setWaitFix] = useState(true);
  const [seq, setSeq] = useState(DEFAULT_SEQ);
  const [autoStep, setAutoStep] = useState('5');

  useFocusEffect(useCallback(() => {
    kvGet('avgEpochs').then((v) => v && setEpochs(v));
    kvGet('accLimit').then((v) => v && setAccLimit(v));
    kvGet('tiltByReceiver').then((v) => setTilt(v === '1'));
    kvGet('volumeShutter').then((v) => setVolKey(v !== '0'));
    kvGet('floatShutter').then((v) => setFloatBtn(v !== '0'));
    kvGet('voice').then((v) => setVoice(v !== '0'));
    kvGet('waitFix').then((v) => setWaitFix(v !== '0'));
    kvGet('shotSeq').then((v) => v && setSeq(v));
    kvGet('autoStep').then((v) => v && setAutoStep(v));
  }, []));

  const save = async () => {
    const e = Math.max(1, Math.min(60, parseInt(epochs, 10) || 2));
    const a = Math.max(0.005, Math.min(100, parseFloat(accLimit.replace(',', '.')) || 0.05));
    await kvSet('avgEpochs', String(e));
    await kvSet('accLimit', String(a));
    await kvSet('tiltByReceiver', tilt ? '1' : '0');
    await kvSet('volumeShutter', volKey ? '1' : '0');
    await kvSet('floatShutter', floatBtn ? '1' : '0');
    await kvSet('voice', voice ? '1' : '0');
    await kvSet('waitFix', waitFix ? '1' : '0');
    const sq = seq.split(/[,\s→>]+/).map((x) => x.trim().toUpperCase()).filter(Boolean).join(',') || DEFAULT_SEQ;
    await kvSet('shotSeq', sq);
    setSeq(sq);
    const st = Math.max(0.5, Math.min(500, parseFloat(autoStep.replace(',', '.')) || 5));
    await kvSet('autoStep', String(st));
    setAutoStep(String(st));
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
          <Text style={[shared.label, { flex: 1, marginTop: 0 }]}>Клавиши громкости снимают точку</Text>
          <Switch value={volKey} onValueChange={setVolKey} />
        </View>
        <Text style={styles.hintText}>
          На экранах «Съёмка» и «Карта» (Android): «громкость −» или «+» снимает текущий объект, повторное
          нажатие во время измерения — отмена. Bluetooth-пульт для селфи работает так же. На других экранах
          клавиши работают как обычно.
        </Text>
        <View style={styles.switchRow}>
          <Text style={[shared.label, { flex: 1, marginTop: 0 }]}>Плавающая кнопка «Измерить»</Text>
          <Switch value={floatBtn} onValueChange={setFloatBtn} />
        </View>
        <Text style={styles.hintText}>
          Круглая кнопка поверх «Съёмки» и «Карты»: нажать — снять, потащить пальцем — переставить в удобное место.
        </Text>
        <View style={styles.switchRow}>
          <Text style={[shared.label, { flex: 1, marginTop: 0 }]}>Голос и сигналы</Text>
          <Switch value={voice} onValueChange={setVoice} />
        </View>
        <Text style={styles.hintText}>
          Сигнал на старте, двойной — точка записана, низкий — ошибка. Голосом: «Дорога 15. Дальше обочина
          справа». Выключено — только сигналы и вибрация.
        </Text>
        <View style={styles.switchRow}>
          <Text style={[shared.label, { flex: 1, marginTop: 0 }]}>Без FIX — ждать, а не спрашивать</Text>
          <Switch value={waitFix} onValueChange={setWaitFix} />
        </View>
        <Text style={styles.hintText}>
          Нажали без FIX — программа ждёт фиксированное решение и снимает сама. Выключено — спрашивает,
          снимать ли по FLOAT.
        </Text>
        <Text style={shared.label}>Порядок поперечника (коды через запятую)</Text>
        <TextInput style={shared.input} value={seq} onChangeText={setSeq} autoCapitalize="characters"
          placeholder={DEFAULT_SEQ} placeholderTextColor={colors.textMuted} />
        <Text style={styles.hintText}>
          Кнопка «⟳» на «Съёмке» и «Карте»: после каждой точки объект сам переходит к следующему по этому
          порядку, после последнего — снова к первому (следующий пикет).
        </Text>
        <Text style={shared.label}>Шаг автосъёмки, м</Text>
        <TextInput style={shared.input} value={autoStep} onChangeText={setAutoStep}
          keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
        <Text style={styles.hintText}>
          Кнопка «Авто»: точка текущего объекта пишется сама каждые столько метров (одна эпоха FIX в допуске).
          «По остановке»: телефон на вехе — понесли и поставили, через 1,5 с неподвижности замер начнётся сам.
          Число эпох для каждого объекта — в «Работа → Коды».
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
