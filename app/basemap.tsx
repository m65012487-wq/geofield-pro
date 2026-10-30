import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { File } from 'expo-file-system';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button } from '../src/components/ui';
import { useActiveProject } from '../src/lib/useActiveProject';
import { fileTitle, loadBasemap, parseDxf, saveBasemap, type Basemap } from '../src/lib/basemap';
import { ScreenHelp } from '../src/components/Help';
import { HELP } from '../src/lib/helpTexts';

/** Подложка проекта (как «Карты-подложки» в LandStar): DXF в местных координатах, слои вкл/выкл. */
export default function BasemapScreen() {
  const { project } = useActiveProject();
  const [bm, setBm] = useState<Basemap | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    if (project) loadBasemap(project.id).then(setBm);
  }, [project?.id]));

  const pick = async () => {
    if (!project) return;
    try {
      const picked = await File.pickFileAsync();
      const f = Array.isArray(picked) ? picked[0] : picked;
      if (!f) return;
      setBusy(true);
      const name = fileTitle(f.uri, 'план DXF');
      const parsed = parseDxf(await f.text(), name);
      await saveBasemap(project.id, parsed);
      setBm(parsed);
      Alert.alert('Подложка загружена', `${name}: ${parsed.lines.length} линий, ${parsed.layers.length} слоёв`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) Alert.alert('Не удалось загрузить', msg);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number) => {
    if (!project || !bm) return;
    const next = { ...bm, layers: bm.layers.map((l, k) => (k === i ? { ...l, visible: !l.visible } : l)) };
    saveBasemap(project.id, next);
    setBm(next);
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <ScreenHelp title="Подложка" text={HELP.basemap} />
      <Button label={bm ? 'Заменить DXF' : 'Загрузить DXF'} onPress={pick} loading={busy} />
      <Text style={[shared.muted, { marginTop: space.md }]}>
        DXF в местной системе (как в AutoCAD). Берутся линии и полилинии; текст и точки не грузятся — подписи и
        реперы удобнее держать в «Реперах». Чтобы позиция легла на план, нужна калибровка.
      </Text>
      {bm && (
        <>
          <Text style={styles.name}>{bm.name}</Text>
          <Text style={shared.muted}>{bm.lines.length} линий · E {bm.bbox[0].toFixed(0)}–{bm.bbox[2].toFixed(0)} · N {bm.bbox[1].toFixed(0)}–{bm.bbox[3].toFixed(0)}</Text>
          <View style={styles.list}>
            {bm.layers.map((l, i) => (
              <View key={l.name} style={styles.row}>
                <View style={[styles.sw, { backgroundColor: l.color }]} />
                <Text style={styles.layer} numberOfLines={1}>{l.name}</Text>
                <Switch value={l.visible} onValueChange={() => toggle(i)} />
              </View>
            ))}
          </View>
          <Button label="Убрать подложку" variant="danger" style={{ marginTop: space.lg }}
            onPress={() => project && Alert.alert('Убрать подложку?', bm.name, [
              { text: 'Нет', style: 'cancel' },
              { text: 'Убрать', style: 'destructive', onPress: () => { saveBasemap(project.id, null); setBm(null); } },
            ])} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800', marginTop: space.xl },
  list: { marginTop: space.md, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.md },
  sw: { width: 14, height: 14, borderRadius: 3 },
  layer: { flex: 1, color: colors.textPrimary, fontSize: font.body },
});
