import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card, QualityBadge } from '../src/components/ui';
import { HelpButton, ScreenHelp } from '../src/components/Help';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useGnss } from '../src/lib/useGnss';
import { useAverager } from '../src/lib/useAverager';
import { localOf, useCalibration } from '../src/lib/calibStore';
import { kvGet, kvSet, listKnown } from '../src/db/database';
import type { KnownPoint } from '../src/db/types';
import { addBaseCheck, listBaseChecks, type BaseCheck } from '../src/lib/baseCheck';
import { beep } from '../src/lib/feedback';

const DEF_PLAN = 0.03;
const DEF_H = 0.04;

const num = (v: string) => parseFloat(v.replace(',', '.'));
const mm = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 1000).toFixed(0)} мм`;
const fmtTime = (ts: number) => {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Контроль на репере: усреднённое FIX-измерение репера сравнивается с каталогом — сразу видно, что с базой или вехой. */
export default function BaseCheckScreen() {
  const { project } = useActiveProject();
  const calib = useCalibration(project?.id);
  const { position } = useGnss();

  const [search, setSearch] = useState('');
  const [known, setKnown] = useState<KnownPoint[]>([]);
  const [sel, setSel] = useState<KnownPoint | null>(null);
  const [tolPlan, setTolPlan] = useState(String(DEF_PLAN));
  const [tolH, setTolH] = useState(String(DEF_H));
  const [epochs, setEpochs] = useState(3);
  const [antH, setAntH] = useState(2);
  const [tilt, setTilt] = useState(false);
  const [history, setHistory] = useState<BaseCheck[]>([]);
  const [result, setResult] = useState<BaseCheck | null>(null);
  const ctx = useRef({ sel: null as KnownPoint | null, calib, pole: 2, tolPlan: DEF_PLAN, tolH: DEF_H, pid: '' });

  const pole = tilt ? 0 : antH;
  const tp = Number.isFinite(num(tolPlan)) && num(tolPlan) > 0 ? num(tolPlan) : DEF_PLAN;
  const th = Number.isFinite(num(tolH)) && num(tolH) > 0 ? num(tolH) : DEF_H;
  ctx.current = { sel, calib, pole, tolPlan: tp, tolH: th, pid: project?.id ?? '' };

  useFocusEffect(useCallback(() => {
    Promise.all([kvGet('avgEpochs'), kvGet('antennaHeight'), kvGet('tiltByReceiver'), kvGet('baseTolPlan'), kvGet('baseTolH')])
      .then(([e, a, t, p, h]) => {
        const ne = parseInt(e ?? '', 10); setEpochs(Number.isFinite(ne) && ne > 0 ? ne : 3);
        const na = parseFloat(a ?? ''); if (Number.isFinite(na)) setAntH(na);
        setTilt(t === '1');
        if (p) setTolPlan(p);
        if (h) setTolH(h);
      });
    if (project) listBaseChecks(project.id).then((l) => setHistory(l.slice().reverse()));
  }, [project?.id]));

  useEffect(() => {
    if (project) listKnown(project.id, search.trim()).then(setKnown);
  }, [project?.id, search]);

  const avg = useAverager(position, epochs, (mean, count) => {
    const c = ctx.current;
    if (!c.sel || !c.pid) return;
    const loc = localOf(c.calib, mean.latitude, mean.longitude, mean.elevation - c.pole);
    if (!loc) { beep('bad'); Alert.alert('Нет калибровки', 'Сначала откалибруйте проект.'); return; }
    const dN = loc.north - c.sel.north; const dE = loc.east - c.sel.east; const dH = loc.height - c.sel.height;
    const ok = Math.hypot(dN, dE) <= c.tolPlan && Math.abs(dH) <= c.tolH;
    const rec: BaseCheck = { ts: Date.now(), name: c.sel.name, dN, dE, dH, ok, epochs: count };
    setResult(rec);
    beep(ok ? 'done' : 'bad');
    addBaseCheck(c.pid, rec).then(() => listBaseChecks(c.pid)).then((l) => setHistory(l.slice().reverse()));
  });

  const saveTol = () => { kvSet('baseTolPlan', String(tp)); kvSet('baseTolH', String(th)); };

  if (!project) {
    return <View style={[shared.container, styles.center]}><Text style={shared.muted}>Сначала выберите проект.</Text></View>;
  }

  const start = () => {
    if (!sel) return Alert.alert('Репер', 'Выберите репер из списка.');
    if (!calib?.cal) return Alert.alert('Нет калибровки', 'Контроль считается в местных координатах — сначала откалибруйте проект.');
    setResult(null);
    saveTol();
    beep('start');
    avg.start(false);
  };

  const plan = result ? Math.hypot(result.dN, result.dE) : 0;

  return (
    <ScrollView style={shared.container} contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <ScreenHelp title="Контроль на репере"
        text={'Что делает: ставите веху на известный репер, программа набирает несколько измерений в FIX, усредняет и сравнивает с координатами репера из каталога.\n\n'
          + 'Когда пользоваться: утром перед съёмкой и после каждой переустановки базы. Если расхождение большое — съёмка будет со сдвигом.\n\n'
          + 'Как:\n1. Выберите репер (поиск по имени).\n2. Поставьте веху строго на репер, проверьте высоту вехи в настройках.\n'
          + '3. Нажмите «Проверить». Измерения идут только в режиме FIX — при потере FIX набор начинается заново.\n'
          + '4. Зелёный результат — в допуске. Красный — проверьте базу (координаты и высоту антенны базы), высоту вехи, калибровку.\n\n'
          + 'Допуски по умолчанию: план 3 см, высота 4 см. Число измерений берётся из настройки усреднения (по умолчанию 3). Нужна калибровка проекта.'} />

      <Card>
        <View style={shared.row}>
          <Text style={[shared.sectionTitle, { flex: 1, marginBottom: 0 }]}>Репер</Text>
          <QualityBadge quality={position?.quality ?? 'none'} />
        </View>
        <TextInput style={[shared.input, { marginTop: space.sm }]} value={search} onChangeText={setSearch}
          placeholder="Поиск репера" placeholderTextColor={colors.textMuted} autoCapitalize="none" />
        <ScrollView style={{ maxHeight: 200, marginTop: space.sm }} nestedScrollEnabled>
          {known.length === 0 && <Text style={shared.muted}>Реперов нет. Загрузите их на экране «Известные пункты».</Text>}
          {known.map((k) => (
            <Pressable key={k.id} onPress={() => setSel(k)} style={[styles.row, sel?.id === k.id && styles.rowOn]}>
              <Text style={styles.rowName}>{k.name}</Text>
              <Text style={styles.rowSub}>H {k.height.toFixed(3)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={[shared.row, { marginTop: space.sm }]}>
          <View style={{ flex: 1 }}>
            <Text style={shared.label}>Допуск план, м</Text>
            <TextInput style={shared.input} value={tolPlan} onChangeText={setTolPlan} onEndEditing={saveTol} keyboardType="decimal-pad" />
          </View>
          <View style={{ width: space.md }} />
          <View style={{ flex: 1 }}>
            <Text style={shared.label}>Допуск высота, м</Text>
            <TextInput style={shared.input} value={tolH} onChangeText={setTolH} onEndEditing={saveTol} keyboardType="decimal-pad" />
          </View>
          <View style={{ marginLeft: space.sm, marginTop: space.lg }}>
            <HelpButton size={20} title="Допуски"
              text={'Допустимое расхождение измеренного репера с каталогом. «План» — по горизонтали (общая длина по N и E), «высота» — по H. Для базы с хорошим RTK обычно 3 см и 4 см. Значения сохраняются.'} />
          </View>
        </View>

        {avg.running ? (
          <>
            <Text style={styles.progress}>Измерение {avg.count} из {epochs}{position?.quality !== 'fix' ? ' · ждём FIX…' : ''}</Text>
            <Button label="Отмена" variant="secondary" onPress={avg.cancel} />
          </>
        ) : (
          <Button label="Проверить" onPress={start} style={{ marginTop: space.md }} disabled={!sel} />
        )}
      </Card>

      {result && (
        <View style={[styles.result, { borderColor: result.ok ? colors.fix : colors.danger, backgroundColor: result.ok ? colors.accentBg : colors.dangerBg }]}>
          <Text style={[styles.verdict, { color: result.ok ? colors.fix : colors.danger }]}>
            {result.ok ? 'В ДОПУСКЕ' : 'РАСХОЖДЕНИЕ — проверьте базу, высоту вехи, калибровку'}
          </Text>
          <Text style={styles.dl}>{result.name} · {result.epochs} изм.</Text>
          <Text style={styles.dl}>ΔN {mm(result.dN)}   ΔE {mm(result.dE)}</Text>
          <Text style={styles.dl}>в плане {(plan * 1000).toFixed(0)} мм (допуск {(tp * 1000).toFixed(0)})</Text>
          <Text style={styles.dl}>ΔH {mm(result.dH)} (допуск {(th * 1000).toFixed(0)})</Text>
        </View>
      )}

      <Card style={{ marginTop: space.lg }}>
        <Text style={shared.sectionTitle}>История проверок</Text>
        {history.length === 0 && <Text style={shared.muted}>Пока нет проверок.</Text>}
        {history.slice(0, 50).map((c, i) => (
          <View key={`${c.ts}-${i}`} style={styles.hist}>
            <Text style={[styles.histMark, { color: c.ok ? colors.fix : colors.danger }]}>{c.ok ? '✓' : '✗'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{c.name} · {fmtTime(c.ts)}</Text>
              <Text style={styles.rowSub}>
                план {(Math.hypot(c.dN, c.dE) * 1000).toFixed(0)} мм · ΔH {mm(c.dH)} · {c.epochs} изм.
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48,
    paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent',
  },
  rowOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  rowName: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700' },
  rowSub: { color: colors.textSecondary, fontSize: font.small },
  progress: { color: colors.accent, fontSize: font.bodyLg, fontWeight: '700', marginVertical: space.md, textAlign: 'center' },
  result: { borderWidth: 3, borderRadius: radius.lg, padding: space.lg, marginTop: space.lg, gap: space.xs },
  verdict: { fontSize: font.title + 2, fontWeight: '900' },
  dl: { color: colors.textPrimary, fontSize: font.bodyLg, fontVariant: ['tabular-nums'] },
  hist: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, gap: space.md },
  histMark: { fontSize: 22, fontWeight: '900', width: 24, textAlign: 'center' },
});
