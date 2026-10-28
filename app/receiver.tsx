import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, TextInput, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card, QualityBadge } from '../src/components/ui';
import { useGnss } from '../src/lib/useGnss';
import {
  bondedDevices, connectReceiver, disconnectReceiver, ensureBtPermission, receiverAvailable, switchToPhone,
  sendToReceiver, NMEA_ENABLE_PRESETS, epochSeconds,
} from '../src/lib/gnss';
import { fmtCoord } from '../src/lib/geo';
import type { BondedDevice } from '../modules/gnss-bt';

/** Подключение приёмника (как «Подключить к устр.» в LandStar) и диагностика потока NMEA. */
export default function ReceiverScreen() {
  const g = useGnss();
  const [devices, setDevices] = useState<BondedDevice[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [cmd, setCmd] = useState('');

  const send = async (lines: string[]) => {
    try {
      for (const l of lines) { await sendToReceiver(l); await new Promise((r) => setTimeout(r, 150)); }
    } catch (e) {
      Alert.alert('Не отправлено', e instanceof Error ? e.message : String(e));
    }
  };

  const refresh = useCallback(async () => {
    if (!receiverAvailable) return;
    const ok = await ensureBtPermission();
    setDevices(ok ? bondedDevices() : []);
  }, []);
  // на iOS список — это поиск BLE рядом, он пополняется по ходу, поэтому перечитываем раз в 2 с
  useFocusEffect(useCallback(() => {
    refresh();
    if (Platform.OS !== 'ios') return;
    const t = setInterval(() => { if (receiverAvailable) setDevices(bondedDevices()); }, 2000);
    return () => clearInterval(t);
  }, [refresh]));

  const connect = (d: BondedDevice) =>
    connectReceiver(d.address).catch((e) => Alert.alert('Не подключился', e instanceof Error ? e.message : String(e)));

  const p = g.position;
  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <Card style={{ marginBottom: space.lg }}>
        <View style={styles.head}>
          <Text style={styles.title}>{g.source === 'phone' ? 'GPS телефона' : g.deviceName ?? 'Приёмник не подключён'}</Text>
          <QualityBadge quality={p?.quality ?? 'none'} />
        </View>
        <Text style={styles.msg}>{g.message}</Text>
        {p && (
          <View style={styles.grid}>
            <Cell label="Широта" value={fmtCoord(p.latitude)} />
            <Cell label="Долгота" value={fmtCoord(p.longitude)} />
            <Cell label="Высота антенны" value={`${p.elevation.toFixed(3)} м`} />
            <Cell label="Спутники" value={String(p.satellites ?? '–')} />
            <Cell label={p.hasSigma ? 'σ план (GST)' : 'σ план (оценка)'} value={`${p.hAccuracy.toFixed(3)} м`} />
            <Cell label={p.hasSigma ? 'σ высота (GST)' : 'σ высота (оценка)'} value={`${p.vAccuracy.toFixed(3)} м`} />
            <Cell label="HDOP" value={p.hdop != null ? p.hdop.toFixed(1) : '–'} />
            <Cell label="Возраст поправок" value={p.diffAge != null && p.diffAge >= 0 ? `${p.diffAge.toFixed(0)} с` : '–'} />
            <Cell label="Эпоха раз в" value={`${epochSeconds()} с`} />
          </View>
        )}
        {g.source === 'receiver' && g.status !== 'idle' && (
          <Button label="Отключить" variant="secondary" onPress={disconnectReceiver} style={{ marginTop: space.md }} />
        )}
      </Card>

      <Text style={styles.group}>{IOS ? 'Устройства Bluetooth LE рядом' : 'Сопряжённые устройства Bluetooth'}</Text>
      {!receiverAvailable && (
        <Text style={shared.muted}>Приёмник работает только в установленном приложении (не в Expo Go).</Text>
      )}
      {receiverAvailable && devices.length === 0 && (
        <Text style={shared.muted}>
          {IOS
            ? 'Поиск… Приёмник должен быть включён. iPhone видит только Bluetooth LE: если приёмник отдаёт данные лишь по классическому Bluetooth, его здесь не будет — тогда работает GPS телефона.'
            : 'Нет сопряжённых устройств. Включите приёмник и сопрягите его в настройках Bluetooth телефона, затем вернитесь сюда.'}
        </Text>
      )}
      {devices.map((d) => (
        <Pressable key={d.address} style={styles.dev} onPress={() => connect(d)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.devName}>{d.name}</Text>
            <Text style={styles.devAddr}>{d.address}</Text>
          </View>
          <Text style={styles.devAct}>Подключить</Text>
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
        <Button label="Обновить список" variant="secondary" onPress={refresh} style={{ flex: 1 }} />
        <Button label="GPS телефона" variant="secondary" onPress={() => switchToPhone()} style={{ flex: 1 }} />
      </View>

      {g.source === 'receiver' && g.status === 'active' && (
        <View style={{ marginTop: space.xl }}>
          <Text style={styles.group}>Диагностика</Text>
          <Text style={styles.msg}>
            Получено байт: {g.bytes}{g.bytes > 0 && !p && !g.rawTail.some((l) => l.includes('GGA')) ? ' — данные идут, но строк GGA нет' : ''}
          </Text>
          {!!g.hexTail && <Text style={styles.raw} selectable>{g.hexTail}</Text>}
          <Text style={[styles.msg, { marginTop: space.md }]}>
            Если координат нет — включить вывод NMEA (GGA, GST раз в секунду). Неподходящие команды приёмник пропустит.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
            {NMEA_ENABLE_PRESETS.map((pr) => (
              <Pressable key={pr.title} style={styles.chip} onPress={() => send(pr.commands)}>
                <Text style={styles.chipT}>{pr.title}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <TextInput style={[shared.input, { flex: 1 }]} value={cmd} onChangeText={setCmd} autoCapitalize="characters"
              placeholder="своя команда" placeholderTextColor={colors.textMuted} />
            <Button label="→" onPress={() => cmd.trim() && send([cmd.trim()])} style={{ width: 64 }} />
          </View>
        </View>
      )}

      <Pressable onPress={() => setShowRaw((v) => !v)} style={{ marginTop: space.xl }}>
        <Text style={styles.group}>{showRaw ? '▾' : '▸'} Поток NMEA</Text>
      </Pressable>
      {showRaw && (
        <Text style={styles.raw} selectable>{g.rawTail.join('\n') || 'нет данных'}</Text>
      )}
    </ScrollView>
  );
}

const IOS = Platform.OS === 'ios';

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  title: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800', flex: 1 },
  msg: { color: colors.textMuted, fontSize: font.small, marginTop: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.md },
  cell: { width: '50%', paddingVertical: space.sm },
  cellLabel: { color: colors.textMuted, fontSize: font.caption },
  cellValue: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  group: {
    color: colors.textSecondary, fontSize: font.small, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: space.md,
  },
  dev: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: space.md, marginBottom: space.sm,
  },
  devName: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700' },
  devAddr: { color: colors.textMuted, fontSize: font.caption },
  devAct: { color: colors.accent, fontSize: font.small, fontWeight: '800' },
  raw: { color: colors.textSecondary, fontSize: 11, fontFamily: 'monospace' },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accentDim },
  chipT: { color: colors.accent, fontSize: font.small, fontWeight: '800' },
});
