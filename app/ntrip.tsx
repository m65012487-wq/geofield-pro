import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, Pressable, Modal, Platform, FlatList } from 'react-native';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { HelpButton, ScreenHelp } from '../src/components/Help';
import { useGnss } from '../src/lib/useGnss';
import {
  ntripAvailable, loadNtripSettings, startNtrip, stopNtrip, ntripSourcetable, getNtrip, subscribeNtrip,
  DEFAULT_NTRIP_PORT, type NtripEvent, type NtripMount, type NtripSettings,
} from '../src/lib/ntrip';

const STATE_TITLE: Record<NtripEvent['state'], string> = {
  stopped: 'Отключено', connecting: 'Подключение…', connected: 'Подключено', error: 'Ошибка',
};

/** Поправки RTK из сети базовых станций (NTRIP): интернет телефона → Bluetooth → приёмник. */
export default function NtripScreen() {
  const g = useGnss();
  const [form, setForm] = useState<NtripSettings>({ host: '', port: DEFAULT_NTRIP_PORT, mount: '', user: '', pass: '' });
  const [ntrip, setNtrip] = useState<NtripEvent>(getNtrip());
  const [list, setList] = useState<NtripMount[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    loadNtripSettings().then(setForm);
    setNtrip(getNtrip());
    return subscribeNtrip(setNtrip);
  }, []);

  const set = (k: keyof NtripSettings) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  // «Повтор» в сообщении — клиент после обрыва сам переподключается, значит ещё работает
  const active = ntrip.state === 'connected' || ntrip.state === 'connecting' ||
    (ntrip.state === 'error' && ntrip.message.includes('Повтор')) || (ntrip.state === 'error' && ntrip.message.includes('переподключение'));
  const receiverOn = g.source === 'receiver' && g.status === 'active';

  const toggle = async () => {
    try {
      if (active) stopNtrip();
      else await startNtrip(form);
    } catch (e) {
      Alert.alert('Не подключиться', e instanceof Error ? e.message : String(e));
    }
  };

  const fetchList = async () => {
    setLoadingList(true);
    try {
      setList(await ntripSourcetable(form));
    } catch (e) {
      Alert.alert('Список не получен', e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  };

  if (Platform.OS !== 'android' || !ntripAvailable) {
    return (
      <View style={[shared.container, shared.pad]}>
        <Text style={shared.muted}>
          {Platform.OS !== 'android' ? 'Только Android.' : 'NTRIP работает только в установленном приложении (не в Expo Go).'}
        </Text>
      </View>
    );
  }

  const lastSec = ntrip.state === 'connected' && ntrip.lastMs >= 0 ? ntrip.lastMs / 1000 : null;
  const stale = lastSec != null && lastSec > 5;
  const stateColor = ntrip.state === 'connected' ? colors.success : ntrip.state === 'error' ? colors.danger : colors.textPrimary;

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad} keyboardShouldPersistTaps="handled">
      <ScreenHelp title="Поправки по интернету (NTRIP)" text={HELP_MAIN} />

      {!receiverOn && (
        <View style={styles.warn}>
          <Text style={styles.warnT}>
            Приёмник не подключён по Bluetooth. Поправки некуда отправлять, а для VRS нет положения. Сначала подключите приёмник на экране «Приёмник».
          </Text>
        </View>
      )}

      <Card style={{ marginBottom: space.lg }}>
        <Text style={shared.label}>Адрес сервера</Text>
        <TextInput style={shared.input} value={form.host} onChangeText={set('host')} editable={!active}
          autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="например, rtk.example.ru"
          placeholderTextColor={colors.textMuted} />

        <Text style={shared.label}>Порт</Text>
        <TextInput style={shared.input} value={form.port} onChangeText={set('port')} editable={!active}
          keyboardType="number-pad" placeholder={DEFAULT_NTRIP_PORT} placeholderTextColor={colors.textMuted} />

        <View style={styles.labelRow}>
          <Text style={[shared.label, { marginTop: 0, marginBottom: 0 }]}>Точка подключения (mountpoint)</Text>
          <HelpButton size={20} title="Точка подключения" text={HELP_MOUNT} />
        </View>
        <TextInput style={shared.input} value={form.mount} onChangeText={set('mount')} editable={!active}
          autoCapitalize="none" autoCorrect={false} placeholder="например, VRS_RTCM3" placeholderTextColor={colors.textMuted} />
        <Button label="Получить список" variant="secondary" onPress={fetchList} loading={loadingList} disabled={active}
          style={{ marginTop: space.sm }} />

        <Text style={shared.label}>Логин</Text>
        <TextInput style={shared.input} value={form.user} onChangeText={set('user')} editable={!active}
          autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.textMuted} />

        <Text style={shared.label}>Пароль</Text>
        <TextInput style={shared.input} value={form.pass} onChangeText={set('pass')} editable={!active}
          secureTextEntry autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.textMuted} />
      </Card>

      <Button label={active ? 'Отключиться от сети' : 'Подключиться'}
        variant={active ? 'danger' : 'primary'} onPress={toggle} style={styles.big} />

      <Card style={{ marginTop: space.lg }}>
        <View style={styles.statHead}>
          <Text style={styles.statTitle}>Состояние</Text>
          <HelpButton size={20} title="Что показывают цифры" text={HELP_STATS} />
        </View>
        <Text style={[styles.state, { color: stateColor }]}>{STATE_TITLE[ntrip.state]}</Text>
        {!!ntrip.message && ntrip.state !== 'stopped' && <Text style={styles.msg}>{ntrip.message}</Text>}
        <View style={styles.grid}>
          <Cell label="Принято" value={`${(ntrip.bytes / 1024).toFixed(1)} КБ`} />
          <Cell label="Скорость" value={`${Math.round(ntrip.rate)} байт/с`} />
          <Cell label="Последние поправки" value={lastSec == null ? '–' : `${lastSec.toFixed(0)} с назад`}
            color={stale ? colors.warning : undefined} />
        </View>
      </Card>

      <PickerModal list={list} onClose={() => setList(null)}
        onPick={(m) => { setForm((f) => ({ ...f, mount: m.name })); setList(null); }} />
    </ScrollView>
  );
}

function PickerModal({ list, onClose, onPick }: { list: NtripMount[] | null; onClose: () => void; onPick: (m: NtripMount) => void }) {
  return (
    <Modal visible={list != null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={shared.modalOverlay} onPress={onClose}>
        <Pressable style={[shared.modalSheet, { maxHeight: '80%' }]} onPress={() => {}}>
          <Text style={shared.modalTitle}>Точки подключения</Text>
          {list && list.length === 0 && <Text style={shared.muted}>Сервер не вернул ни одной точки.</Text>}
          <FlatList data={list ?? []} keyExtractor={(m) => m.name}
            renderItem={({ item }) => (
              <Pressable style={styles.mount} onPress={() => onPick(item)}>
                <Text style={styles.mountName}>{item.name}</Text>
                <Text style={styles.mountInfo}>
                  {item.format}{item.lat != null && item.lon != null ? `  ·  ${item.lat.toFixed(3)}, ${item.lon.toFixed(3)}` : ''}
                </Text>
              </Pressable>
            )} />
          <Button label="Закрыть" variant="secondary" onPress={onClose} style={{ marginTop: space.md }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={[styles.cellValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const HELP_MAIN =
  'NTRIP — это способ получать поправки RTK из интернета. Сеть базовых станций (коммерческая или региональная) шлёт поправки на ваш телефон, а телефон по Bluetooth передаёт их в приёмник. Со своей базой и радиомодемом возиться не нужно.\n\n' +
  'Где взять данные: адрес сервера, порт, точку подключения, логин и пароль выдаёт оператор сети базовых станций или дилер, у которого вы покупали приёмник. Порт обычно 2101.\n\n' +
  'Что вводить: адрес и порт, затем логин и пароль. Точку подключения можно выбрать из списка по кнопке «Получить список» (нужны адрес, порт, логин и пароль).\n\n' +
  'Важно:\n' +
  '• на один логин — одно подключение; если зашли с другого устройства, будет отказ;\n' +
  '• нужен мобильный интернет на телефоне; без связи поправки не идут;\n' +
  '• приёмник должен быть подключён по Bluetooth и принимать поправки по этому же каналу (источник поправок — порт/Bluetooth, а не радио);\n' +
  '• для сетевых решений (VRS) приложение само отправляет положение приёмника на сервер раз в 10 секунд.\n\n' +
  'Когда оставаться на своей базе iBase по радио: вне зоны мобильной связи или когда работаете рядом с базой. Тогда подключение здесь не нужно — лучше его отключить, чтобы не было двух источников поправок.';

const HELP_MOUNT =
  'Точка подключения (mountpoint) — название потока поправок на сервере, например VRS_RTCM3. Для съёмки обычно берут сетевое решение (VRS) или ближайшую базовую станцию в формате RTCM 3.\n\n' +
  'Если не знаете название, введите адрес, порт, логин и пароль и нажмите «Получить список», затем выберите точку. Формат должен быть RTCM 3.x, и приёмник должен его понимать. Если у точки указаны координаты, это положение станции.';

const HELP_STATS =
  'Принято — сколько данных поправок получено с сервера за это подключение.\n\n' +
  'Скорость — обычно несколько сотен байт в секунду; ноль при «Подключено» значит, что сервер молчит.\n\n' +
  'Последние поправки — сколько секунд назад пришли данные. Больше 5 с (жёлтым) — связь нестабильна, фиксированное решение может пропасть.';

const styles = StyleSheet.create({
  warn: {
    backgroundColor: colors.dangerBg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger,
    padding: space.md, marginBottom: space.lg,
  },
  warnT: { color: colors.warning, fontSize: font.small, fontWeight: '700' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm, marginBottom: 4 },
  big: { minHeight: 72 },
  statHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statTitle: { color: colors.textSecondary, fontSize: font.small, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  state: { fontSize: font.title, fontWeight: '800', marginTop: space.sm },
  msg: { color: colors.textMuted, fontSize: font.small, marginTop: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.md },
  cell: { width: '50%', paddingVertical: space.sm },
  cellLabel: { color: colors.textMuted, fontSize: font.caption },
  cellValue: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mount: { paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  mountName: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700' },
  mountInfo: { color: colors.textMuted, fontSize: font.caption },
});
