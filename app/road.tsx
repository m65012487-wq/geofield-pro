import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, Pressable, Modal } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { File } from 'expo-file-system';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { useActiveProject } from '../src/lib/useActiveProject';
import { kvSet } from '../src/db/database';
import { fileTitle } from '../src/lib/basemap';
import {
  addRoad, buildRoad, fmtPk, loadRoads, renameRoad, saveRoad, setActiveRoad, withLine, SIDE_TITLE,
  type Road, type RoadSet, type SideLine,
} from '../src/lib/road';
import { HelpButton, ScreenHelp } from '../src/components/Help';
import { DEFAULT_ROAD_SETTINGS, loadRoadSettings } from '../src/lib/roadCheck';

const HELP = `Здесь загружается проект дороги — по нему каждая снятая точка сразу получает пикет, смещение от оси и отклонение от проектной отметки.

1. «Загрузить ось» — txt «ПК,N,E,H» (например «ось чегем II-булунгу.txt» из папки 01_Проект/txt). H в файле — проектная отметка оси.
2. Кромки и бровки — те же файлы для левой и правой стороны. С ними программа знает проектную отметку не только на оси, а по всей ширине, и проектный поперечный уклон.
3. Осей может быть несколько: основная дорога, съезд, кювет, подпорная стенка — у каждой свой пикетаж. Считается всё по АКТИВНОЙ оси (отмечена ●). Нажмите на ось, чтобы сделать её активной, удержите — переименовать.
4. Допуски — внизу. По ним точка красная или зелёная.

Нужна калибровка: пикет считается по местным координатам.`;

/**
 * Трасса проекта: ось с пикетажем и проектными отметками, кромки и бровки (txt «ПК,N,E,H», как выгрузки проекта).
 * По ней каждая точка получает пикет и смещение, отклонение от проекта и уклоны.
 */
export default function RoadScreen() {
  const { project } = useActiveProject();
  const [set, setSetState] = useState<RoadSet>({ active: 0, list: [] });
  const road: Road | null = set.list[set.active] ?? null;
  const setRoad = (_r: Road | null) => { if (project) loadRoads(project.id).then(setSetState); };
  const [rename, setRename] = useState<{ i: number; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ tolH: '', tolSlope: '', secTol: '', pkStep: '' });

  useFocusEffect(useCallback(() => {
    if (project) loadRoads(project.id).then(setSetState);
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

  const run = async (what: 'axis' | 'newAxis' | SideLine) => {
    if (!project) return;
    try {
      const got = await pickText();
      if (!got) return;
      setBusy(what);
      let next: Road;
      if (what === 'axis' || what === 'newAxis') {
        next = buildRoad(got.name.replace(/\.txt$/i, ''), got.text);
        // кромки и бровки старой оси к новой не подходят — сбрасываются
      } else {
        if (!road) throw new Error('Сначала загрузите ось');
        next = withLine(road, what, got.text);
      }
      if (what === 'newAxis') addRoad(project.id, next); else saveRoad(project.id, next);
      setRoad(next);
      if (what === 'axis' || what === 'newAxis') {
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
      <ScreenHelp title="Трасса и допуски" text={HELP} />
      {set.list.length > 1 && (
        <Card style={{ marginBottom: space.lg }}>
          <Text style={styles.title}>Оси проекта</Text>
          {set.list.map((r, i) => (
            <Pressable key={i} style={styles.lineRow} onPress={() => { setActiveRoad(project.id, i); setRoad(null); }}
              onLongPress={() => setRename({ i, name: r.name })}>
              <Text style={[styles.lineT, { flex: 1 }, i === set.active && { color: colors.accent }]}>
                {i === set.active ? '● ' : '○ '}{r.name}
              </Text>
              <Text style={styles.lineS}>ПК {fmtPk(r.pk[0], 0)} – {fmtPk(r.pk[r.pk.length - 1], 0)}</Text>
            </Pressable>
          ))}
        </Card>
      )}
      <Card>
        <Text style={styles.title}>{set.list.length > 1 ? 'Активная ось' : 'Ось'}</Text>
        <Text style={styles.desc}>
          {road
            ? `${road.name}: ${road.pk.length} точек, ПК ${fmtPk(road.pk[0])} – ${fmtPk(road.pk[road.pk.length - 1])}`
            : 'txt «ПК,N,E,H» — например «ось чегем II-булунгу.txt» из 01_Проект\\txt. H — проектная отметка оси.'}
        </Text>
        <Button label={road ? 'Заменить ось' : 'Загрузить ось'} onPress={() => run('axis')} loading={busy === 'axis'} style={{ marginTop: space.md }} />
        {road && (
          <Button label="＋ Добавить ещё ось (съезд, кювет…)" variant="secondary" onPress={() => run('newAxis')}
            loading={busy === 'newAxis'} style={{ marginTop: space.sm }} />
        )}
      </Card>

      {road && (
        <Card style={{ marginTop: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text style={[styles.title, { flex: 1 }]}>Кромки и бровки</Text>
            <HelpButton size={20} title="Кромки и бровки"
              text={`Кромка — край покрытия (асфальта), бровка — край земляного полотна (обочины). Файлы того же формата «ПК,N,E,H». Программа сама проверяет сторону: если «левая» лежит справа от оси — скажет, что выбран не тот файл.

Между линиями проектная отметка считается по прямой: ось → кромка → бровка. За бровкой (кювет, откос) проекта нет — там отклонение не считается.`} />
          </View>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[styles.title, { flex: 1 }]}>Допуски и поперечники</Text>
          <HelpButton size={20} title="Допуски"
            text={`Допуск по высоте — сколько миллиметров факт может отличаться от проекта (по СП 78.13330 по оси ±50 мм).

Допуск уклона — разница фактического и проектного поперечного уклона в промилле (СП: ±10 ‰).

«Один поперечник» — точки ближе этого по пикету считаются одним поперечным сечением: из них считаются уклоны, толщина и площади.

Шаг пикетов — через сколько метров таблица «Полнота» ждёт точки каждого объекта.`} />
        </View>
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
      <Modal visible={rename != null} transparent animationType="fade" onRequestClose={() => setRename(null)}>
        <View style={shared.modalOverlay}>
          <View style={shared.modalSheet}>
            <Text style={shared.modalTitle}>Название оси</Text>
            <TextInput style={shared.input} value={rename?.name ?? ''} onChangeText={(t) => rename && setRename({ ...rename, name: t })} />
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <Button label="Отмена" variant="secondary" style={{ flex: 1 }} onPress={() => setRename(null)} />
              <Button label="Сохранить" style={{ flex: 1 }} onPress={() => {
                if (rename && rename.name.trim()) renameRoad(project.id, rename.i, rename.name.trim());
                setRename(null); setRoad(null);
              }} />
            </View>
          </View>
        </View>
      </Modal>
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
