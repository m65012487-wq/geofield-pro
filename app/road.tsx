import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { File } from 'expo-file-system';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { useActiveProject } from '../src/lib/useActiveProject';
import { kvSet } from '../src/db/database';
import { fileTitle } from '../src/lib/basemap';
import { buildRoad, fmtPk, loadRoad, saveRoad, withLine, SIDE_TITLE, type Road, type SideLine } from '../src/lib/road';
import { DEFAULT_ROAD_SETTINGS, loadRoadSettings } from '../src/lib/roadCheck';

/**
 * Трасса проекта: ось с пикетажем и проектными отметками, кромки и бровки (txt «ПК,N,E,H», как выгрузки проекта).
 * По ней каждая точка получает пикет и смещение, отклонение от проекта и уклоны.
 */
export default function RoadScreen() {
  const { project } = useActiveProject();
  const [road, setRoad] = useState<Road | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ tolH: '', tolSlope: '', secTol: '', pkStep: '' });

  useFocusEffect(useCallback(() => {
    if (project) loadRoad(project.id).then(setRoad);
    loadRoadSettings().then((s) => setForm({
      tolH: String(s.tolH), tolSlope: String(s.tolSlope), secTol: String(s.secTol), pkStep: String(s.pkStep),
    }));
  }, [project?.id]));

  const pickText = async () => {
    const picked = await File.pickFileAsync();
    const f = Array.isArray(picked) ? picked[0] : picked;
    if (!f) return null;
    return { name: fileTitle(f.uri, 'ось.txt'), text: await f.text() };
  };

  const run = async (what: 'axis' | SideLine) => {
    if (!project) return;
    try {
      const got = await pickText();
      if (!got) return;
      setBusy(what);
      let next: Road;
      if (what === 'axis') {
        next = buildRoad(got.name, got.text);
        // кромки и бровки старой оси к новой не подходят — сбрасываются
      } else {
        if (!road) throw new Error('Сначала загрузите ось');
        next = withLine(road, what, got.text);
      }
      saveRoad(project.id, next);
      setRoad(next);
      if (what === 'axis') {
        Alert.alert('Ось загружена', `${got.name}: ${next.pk.length} точек, ПК ${fmtPk(next.pk[0])} – ${fmtPk(next.pk[next.pk.length - 1])}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) Alert.alert('Не удалось загрузить', msg);
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async () => {
    const num = (v: string, def: number, lo: number, hi: number) => {
      const x = parseFloat(v.replace(',', '.'));
      return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def;
    };
    const d = DEFAULT_ROAD_SETTINGS;
    const s = {
      tolH: num(form.tolH, d.tolH, 1, 1000), tolSlope: num(form.tolSlope, d.tolSlope, 0.5, 200),
      secTol: num(form.secTol, d.secTol, 0.2, 50), pkStep: num(form.pkStep, d.pkStep, 1, 1000),
    };
    await Promise.all(Object.entries(s).map(([k, v]) => kvSet(k, String(v))));
    setForm({ tolH: String(s.tolH), tolSlope: String(s.tolSlope), secTol: String(s.secTol), pkStep: String(s.pkStep) });
    Alert.alert('Сохранено', 'Допуски применятся к следующим точкам и в ведомости.');
  };

  if (!project) {
    return <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}><Text style={shared.muted}>Сначала выберите проект.</Text></View>;
  }

  const lineInfo = (k: SideLine) => {
    const l = road?.lines[k];
    if (!l) return 'не загружена';
    const ok = l.off.filter(Number.isFinite);
    if (!ok.length) return 'не легла на ось';
    const mean = ok.reduce((a, b) => a + b, 0) / ok.length;
    return `${ok.length} станций · в среднем ${Math.abs(mean).toFixed(2)} м от оси`;
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <Card>
        <Text style={styles.title}>Ось</Text>
        <Text style={styles.desc}>
          {road
            ? `${road.name}: ${road.pk.length} точек, ПК ${fmtPk(road.pk[0])} – ${fmtPk(road.pk[road.pk.length - 1])}`
            : 'txt «ПК,N,E,H» — например «ось чегем II-булунгу.txt» из 01_Проект\\txt. H — проектная отметка оси.'}
        </Text>
        <Button label={road ? 'Заменить ось' : 'Загрузить ось'} onPress={() => run('axis')} loading={busy === 'axis'} style={{ marginTop: space.md }} />
      </Card>

      {road && (
        <Card style={{ marginTop: space.lg }}>
          <Text style={styles.title}>Кромки и бровки</Text>
          <Text style={styles.desc}>
            Нужны для проектной отметки не на оси и проектного уклона. Тот же формат «ПК,N,E,H».
            Без них проект сравнивается только у оси (±0,5 м).
          </Text>
          {(['KL', 'KR', 'BL', 'BR'] as SideLine[]).map((k) => (
            <Pressable key={k} style={styles.lineRow} onPress={() => run(k)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineT}>{SIDE_TITLE[k]}</Text>
                <Text style={[styles.lineS, road.lines[k] && { color: colors.fix }]}>{busy === k ? 'загрузка…' : lineInfo(k)}</Text>
              </View>
              <Text style={styles.lineBtn}>{road.lines[k] ? 'Заменить' : 'Загрузить'}</Text>
            </Pressable>
          ))}
          <Button label="Убрать трассу" variant="danger" style={{ marginTop: space.lg }}
            onPress={() => Alert.alert('Убрать трассу?', road.name, [
              { text: 'Нет', style: 'cancel' },
              { text: 'Убрать', style: 'destructive', onPress: () => { saveRoad(project.id, null); setRoad(null); } },
            ])} />
        </Card>
      )}

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.title}>Допуски и поперечники</Text>
        <Field label="Допуск по высоте, мм (СП 78: ±50 по оси)" value={form.tolH} onChange={(v) => setForm({ ...form, tolH: v })} />
        <Field label="Допуск поперечного уклона, ‰ (СП 78: ±10)" value={form.tolSlope} onChange={(v) => setForm({ ...form, tolSlope: v })} />
        <Field label="Один поперечник — точки ближе по пикету, м" value={form.secTol} onChange={(v) => setForm({ ...form, secTol: v })} />
        <Field label="Шаг пикетов для контроля полноты, м" value={form.pkStep} onChange={(v) => setForm({ ...form, pkStep: v })} />
        <Button label="Сохранить" onPress={saveSettings} style={{ marginTop: space.md }} />
      </Card>

      <Text style={[shared.muted, { marginTop: space.lg, lineHeight: 19 }]}>
        Пикет и смещение считаются по местным координатам — нужна калибровка. Смещение: вправо по ходу пикетажа «+», влево «−».
        Уклоны в ‰ от середины наружу, минус — вниз от оси.
      </Text>
    </ScrollView>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Text style={shared.label}>{label}</Text>
      <TextInput style={shared.input} value={value} onChangeText={onChange} keyboardType="decimal-pad" />
    </>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800' },
  desc: { color: colors.textSecondary, fontSize: font.small, marginTop: 6, lineHeight: 19 },
  lineRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, marginTop: space.sm,
    borderTopWidth: 1, borderTopColor: colors.border, gap: space.md,
  },
  lineT: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700' },
  lineS: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  lineBtn: {
    color: colors.accent, fontSize: font.small, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.accentDim,
  },
});
