import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, Switch } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { File } from 'expo-file-system';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { HelpButton, ScreenHelp } from '../src/components/Help';
import { useActiveProject } from '../src/lib/useActiveProject';
import { kvGet, kvSet } from '../src/db/database';
import { importBackup, lastBackupDate, parseBackup, sendBackup, type ImportMode, type MergeReport } from '../src/lib/backup';

const SCREEN_HELP = `Зачем это. Все точки лежат только в телефоне. Копия — один файл, по которому всё можно вернуть.

Если телефон потерян или сломан:
1. На новом телефоне поставьте программу.
2. Скачайте файл копии из Telegram (самый свежий «…_копия_….geofield.json»).
3. Откройте «Копия и обмен» → «Слить / восстановить из файла» → выберите файл.
4. Выберите «Отдельным проектом» или «В текущий» и подтвердите.

Работа вдвоём:
1. У каждого своя метка устройства («А» и «Б») — впишите её вверху.
2. Вечером каждый жмёт «Отправить копию сейчас» и присылает файл другому.
3. Второй открывает файл через «Слить». Новые точки добавятся, уже имеющиеся пропустятся.
4. Если у обоих есть точка с одним именем (например DOR1), входящая получит к имени метку: DOR1-Б.

Что не входит в копию: фото и голосовые заметки. Они остаются на своём телефоне.
Калибровка и трасса берутся из файла, только если у вас они пустые. Свои не затираются.`;

export default function BackupScreen() {
  const { project } = useActiveProject();
  const [tag, setTag] = useState('');
  const [auto, setAuto] = useState(false);
  const [withBase, setWithBase] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'import' | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      setTag((await kvGet('deviceTag')) ?? '');
      setAuto((await kvGet('autoBackup')) === '1');
      setWithBase((await kvGet('backupBasemap')) === '1');
      if (project) setLast(await lastBackupDate(project.id));
    })();
  }, [project?.id]));

  const saveTag = (v: string) => { setTag(v); kvSet('deviceTag', v.trim()); };
  const toggleAuto = (v: boolean) => { setAuto(v); kvSet('autoBackup', v ? '1' : '0'); };
  const toggleBase = (v: boolean) => { setWithBase(v); kvSet('backupBasemap', v ? '1' : '0'); };

  const send = async () => {
    if (!project) return;
    setBusy('send');
    try {
      const how = await sendBackup(project.id, { withBasemap: withBase });
      setLast(await lastBackupDate(project.id));
      if (how === 'telegram') Alert.alert('Отправлено', 'Копия ушла в Telegram.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) Alert.alert('Не удалось отправить', msg);
    } finally {
      setBusy(null);
    }
  };

  const report = (r: MergeReport) => {
    const what = { taken: 'взята из файла', kept: 'оставлена ваша', none: 'в файле нет' } as const;
    const lines = [
      `Добавлено: точек ${r.added.points}, линий ${r.added.features}, реперов ${r.added.known}, кодов ${r.added.codes}`,
      `Пропущено (уже были): точек ${r.skipped.points}, линий ${r.skipped.features}, реперов ${r.skipped.known}`,
      `Калибровка: ${what[r.calib]}`,
      `Трасса: ${what[r.roads]}`,
    ];
    if (r.basemap !== 'none') lines.push(`Подложка: ${what[r.basemap]}`);
    if (r.renamed.length) {
      const shown = r.renamed.slice(0, 15).map((x) => `${x.from} → ${x.to}`).join('\n');
      lines.push(`Переименовано ${r.renamed.length}:\n${shown}${r.renamed.length > 15 ? '\n…' : ''}`);
    }
    Alert.alert('Готово', lines.join('\n'));
  };

  const doImport = async (text: string, mode: ImportMode) => {
    setBusy('import');
    try {
      const r = await importBackup(text, { mode, currentPid: project?.id });
      if (project) setLast(await lastBackupDate(project.id));
      report(r);
    } catch (e) {
      Alert.alert('Не удалось слить', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pick = async () => {
    try {
      const picked = await File.pickFileAsync();
      const f = Array.isArray(picked) ? picked[0] : picked;
      if (!f) return;
      const text = await f.text();
      const pack = parseBackup(text);
      const info = `«${pack.project.name}»${pack.device ? `, устройство ${pack.device}` : ''}\n`
        + `Точек в файле: ${pack.points.length}, от ${new Date(pack.createdAt).toLocaleString('ru-RU')}`;
      const buttons: Array<{ text: string; style?: 'cancel'; onPress?: () => void }> = [];
      if (project) buttons.push({ text: `В текущий («${project.name}»)`, onPress: () => doImport(text, 'current') });
      buttons.push({ text: 'Отдельным проектом', onPress: () => doImport(text, 'separate') });
      buttons.push({ text: 'Отмена', style: 'cancel' });
      Alert.alert('Слить из файла?', `${info}\n\nУже имеющиеся точки пропустятся, совпавшие имена получат метку устройства.`, buttons);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) Alert.alert('Не удалось открыть', msg);
    }
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <ScreenHelp title="Копия и обмен" text={SCREEN_HELP} />

      <Card>
        <View style={styles.row}>
          <Text style={styles.title}>Метка устройства</Text>
          <HelpButton size={20} title="Метка устройства"
            text={'Короткая буква этого телефона, например «А» или «Б». У двух телефонов метки должны быть разными. Если при слиянии имена точек совпадут, входящая получит эту метку: DOR1-Б.'} />
        </View>
        <TextInput style={[shared.input, { marginTop: space.sm }]} value={tag} onChangeText={saveTag}
          placeholder="А" placeholderTextColor={colors.textMuted} maxLength={4} />
      </Card>

      {project ? (
        <Card style={{ marginTop: space.lg }}>
          <Text style={styles.title}>Проект «{project.name}»</Text>
          <Text style={styles.desc}>Последняя копия: {last ?? 'ещё не отправляли'}</Text>

          <View style={[styles.row, { marginTop: space.md }]}>
            <Text style={[styles.lineT, { flex: 1 }]}>Автокопия раз в день в Telegram</Text>
            <HelpButton size={20} title="Автокопия"
              text={'При открытии съёмки программа раз в день тихо отправит копию в ваш Telegram-бот, если с прошлой копии появились новые точки. Без настроенного бота автокопия не работает.'} />
            <Switch value={auto} onValueChange={toggleAuto} />
          </View>
          <View style={[styles.row, { marginTop: space.md }]}>
            <Text style={[styles.lineT, { flex: 1 }]}>С подложкой</Text>
            <HelpButton size={20} title="С подложкой"
              text={'Подложка из DXF может быть большой, файл станет тяжелее. Включайте, если нужно перенести её на другой телефон.'} />
            <Switch value={withBase} onValueChange={toggleBase} />
          </View>

          <Button label="Отправить копию сейчас" onPress={send} loading={busy === 'send'} style={{ marginTop: space.lg }} />
        </Card>
      ) : (
        <Text style={[shared.muted, { marginTop: space.lg }]}>Проект не выбран: отправить копию нельзя, но слить файл можно отдельным проектом.</Text>
      )}

      <Card style={{ marginTop: space.lg }}>
        <View style={styles.row}>
          <Text style={styles.title}>Слить / восстановить</Text>
          <HelpButton size={20} title="Слить из файла"
            text={'Выберите файл копии (.geofield.json), например скачанный из Telegram. Новые точки добавятся, уже имеющиеся пропустятся, ничего не удаляется. Калибровка и трасса берутся из файла, только если у вас они пустые.'} />
        </View>
        <Text style={styles.desc}>Фото и голосовые заметки в копию не входят.</Text>
        <Button label="Слить / восстановить из файла" variant="secondary" onPress={pick}
          loading={busy === 'import'} style={{ marginTop: space.md }} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800', flexShrink: 1 },
  desc: { color: colors.textSecondary, fontSize: font.small, marginTop: 6, lineHeight: 19 },
  lineT: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700' },
});
