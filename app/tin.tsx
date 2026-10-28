import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, Pressable, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { HelpButton, ScreenHelp } from '../src/components/Help';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useCalibration, localOf } from '../src/lib/calibStore';
import { listCodes, listPoints } from '../src/db/database';
import type { SurveyPoint } from '../src/db/types';
import { buildTin, tinBounds, TIN_MAX_POINTS, volumeBetween, type Tin, type TinPoint, type VolumeResult } from '../src/lib/tin';

const fmt = (v: number, d: number) => v.toFixed(d).replace('.', ',');
const num = (s: string) => parseFloat(s.replace(',', '.').trim());

interface Result {
  vol: VolumeResult;
  top: Tin;
  basePts: number;
  baseTris: number;
  plane: number | null;
}

/**
 * Объём по поверхности: TIN по съёмке сверху и основание — плоскость или съёмка «до»;
 * объёмы отсыпки и срезки суммируются по регулярной сетке.
 */
export default function TinScreen() {
  const { project } = useActiveProject();
  const calib = useCalibration(project?.id);
  const { width } = useWindowDimensions();
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [allCodes, setAllCodes] = useState<string[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [baseMode, setBaseMode] = useState<'plane' | 'before'>('plane');
  const [planeH, setPlaneH] = useState('');
  const [maxEdge, setMaxEdge] = useState('30');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  useFocusEffect(useCallback(() => {
    if (!project) return;
    (async () => {
      const [pts, codes] = await Promise.all([listPoints(project.id), listCodes()]);
      setPoints(pts);
      const present = new Set(pts.map((p) => p.code));
      const list = [...codes.map((c) => c.code).filter((c) => present.has(c)), ...[...present].filter((c) => !codes.some((x) => x.code === c))];
      setAllCodes(list);
      setSel((cur) => (cur.length ? cur.filter((c) => list.includes(c)) : list.filter((c) => c !== '')));
    })();
  }, [project?.id]));

  const toTin = (p: SurveyPoint): TinPoint | null => {
    if (p.north != null && p.east != null && p.height != null) return { x: p.east, y: p.north, z: p.height };
    const l = localOf(calib, p.latitude, p.longitude, p.elevation);
    return l ? { x: l.east, y: l.north, z: l.height } : null;
  };

  const topPts = useMemo(() => points.filter((p) => sel.includes(p.code) && p.stage !== 'до'), [points, sel]);
  const beforePts = useMemo(() => points.filter((p) => sel.includes(p.code) && p.stage === 'до'), [points, sel]);

  const toggle = (c: string) => setSel(sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]);

  const run = () => {
    const L = num(maxEdge);
    if (!Number.isFinite(L) || L <= 0) { Alert.alert('Длина ребра', 'Введите максимальную длину ребра, м.'); return; }
    const H = num(planeH);
    if (baseMode === 'plane' && !Number.isFinite(H)) { Alert.alert('Плоскость', 'Введите отметку плоскости H.'); return; }
    setBusy(true);
    // даём интерфейсу показать индикатор: расчёт синхронный
    setTimeout(() => {
      try {
        const a = topPts.map(toTin).filter((x): x is TinPoint => x != null);
        if (a.length < 3) throw new Error('Для поверхности нужно минимум 3 точки с местными координатами (калибровка).');
        if (a.length > TIN_MAX_POINTS) throw new Error(`Точек ${a.length}, максимум ${TIN_MAX_POINTS}. Выберите меньше кодов.`);
        const top = buildTin(a, L);
        if (!top.tris.length) throw new Error('Не получилось ни одного треугольника: увеличьте максимальную длину ребра.');
        let base: Tin | number = H;
        let basePts = 0, baseTris = 0;
        if (baseMode === 'before') {
          const b = beforePts.map(toTin).filter((x): x is TinPoint => x != null);
          if (b.length < 3) throw new Error('Для съёмки «до» нужно минимум 3 точки с этапом «до» выбранных кодов.');
          if (b.length > TIN_MAX_POINTS) throw new Error(`Точек «до» ${b.length}, максимум ${TIN_MAX_POINTS}.`);
          const bt = buildTin(b, L);
          if (!bt.tris.length) throw new Error('В съёмке «до» нет треугольников: увеличьте длину ребра.');
          base = bt; basePts = bt.pts.length; baseTris = bt.tris.length;
        }
        const vol = volumeBetween(top, base);
        setRes({ vol, top, basePts, baseTris, plane: baseMode === 'plane' ? H : null });
      } catch (e) {
        setRes(null);
        Alert.alert('Не удалось рассчитать', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  if (!project) {
    return <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}><Text style={shared.muted}>Сначала выберите проект.</Text></View>;
  }

  const size = Math.max(200, width - space.lg * 2 - space.lg * 2);

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad} keyboardShouldPersistTaps="handled">
      <ScreenHelp title="Объём по поверхности" text={HELP} />

      <Card>
        <View style={shared.row}>
          <Text style={[styles.title, { flex: 1, marginBottom: 0 }]}>Поверхность (коды точек)</Text>
          <HelpButton size={20} title="Коды поверхности" text={HELP_CODES} />
        </View>
        <View style={styles.chips}>
          {allCodes.length === 0 && <Text style={shared.muted}>В проекте нет точек.</Text>}
          {allCodes.map((c) => (
            <Chip key={c || '_'} label={c || 'без кода'} on={sel.includes(c)} onPress={() => toggle(c)} />
          ))}
        </View>
        <Text style={styles.hint}>Сверху: {topPts.length} т. · «До»: {beforePts.length} т.</Text>
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <Text style={styles.title}>Основание</Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip label="Плоскость H" on={baseMode === 'plane'} onPress={() => setBaseMode('plane')} />
          <Chip label="Съёмка «до»" on={baseMode === 'before'} onPress={() => setBaseMode('before')} />
        </View>
        {baseMode === 'plane' && (
          <>
            <Text style={shared.label}>Отметка плоскости H, м</Text>
            <TextInput style={shared.input} value={planeH} onChangeText={setPlaneH} placeholder="например 412,350"
              placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" />
          </>
        )}
        <View style={[shared.row, { marginTop: space.sm }]}>
          <Text style={[shared.label, { flex: 1 }]}>Макс. длина ребра треугольника, м</Text>
          <HelpButton size={20} title="Длина ребра" text={HELP_EDGE} />
        </View>
        <TextInput style={shared.input} value={maxEdge} onChangeText={setMaxEdge}
          placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" />
      </Card>

      <Button label="Рассчитать" onPress={run} loading={busy} style={{ marginTop: space.lg }} />

      {res && (
        <>
          <View style={shared.resultBox}>
            <Text style={shared.resultLabel}>Отсыпка (выше основания)</Text>
            <Text style={shared.resultValue}>{fmt(res.vol.fill, 2)} м³</Text>
            <Text style={shared.resultLabel}>Срезка (ниже основания)</Text>
            <Text style={shared.resultValue}>{fmt(res.vol.cut, 2)} м³</Text>
            <Text style={shared.resultLabel}>Разность (отсыпка − срезка)</Text>
            <Text style={shared.resultValue}>{fmt(res.vol.fill - res.vol.cut, 2)} м³</Text>
            <Text style={shared.resultLabel}>Площадь расчёта</Text>
            <Text style={shared.resultValue}>{fmt(res.vol.area, 1)} м²</Text>
            <Text style={styles.hint}>
              Точек {res.top.pts.length}, треугольников {res.top.tris.length}
              {res.baseTris ? ` (основание: ${res.basePts} т., ${res.baseTris} тр.)` : ''} · шаг сетки {fmt(res.vol.step, 2)} м, узлов {res.vol.nodes}
            </Text>
          </View>
          <Card style={{ marginTop: space.lg, alignItems: 'center' }}>
            <TinPlot tin={res.top} size={size} />
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function TinPlot({ tin, size }: { tin: Tin; size: number }) {
  const { d, dots } = useMemo(() => {
    const b = tinBounds(tin);
    const w = Math.max(b.maxX - b.minX, 0.001), h = Math.max(b.maxY - b.minY, 0.001);
    const k = (size - 8) / Math.max(w, h);
    const X = (x: number) => 4 + (x - b.minX) * k;
    const Y = (y: number) => 4 + (b.maxY - y) * k; // север вверх
    const parts: string[] = [];
    for (const [a, bb, c] of tin.tris) {
      const A = tin.pts[a], B = tin.pts[bb], C = tin.pts[c];
      parts.push(`M${X(A.x + tin.ox).toFixed(1)} ${Y(A.y + tin.oy).toFixed(1)}L${X(B.x + tin.ox).toFixed(1)} ${Y(B.y + tin.oy).toFixed(1)}L${X(C.x + tin.ox).toFixed(1)} ${Y(C.y + tin.oy).toFixed(1)}Z`);
    }
    return {
      d: parts.join(''),
      dots: tin.pts.length <= 400 ? tin.pts.map((p) => ({ x: X(p.x + tin.ox), y: Y(p.y + tin.oy) })) : [],
      h: h * k,
    };
  }, [tin, size]);
  return (
    <Svg width={size} height={size}>
      <Path d={d} stroke={colors.accentDim} strokeWidth={0.7} fill={colors.accentBg} fillOpacity={0.6} />
      {dots.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={2} fill={colors.textPrimary} />)}
    </Svg>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && { color: colors.accentText }]}>{label}</Text>
    </Pressable>
  );
}

const HELP = [
  'Считает объём кучи, котлована или вывоза грунта по точкам съёмки: строит из точек поверхность из треугольников (TIN) и сравнивает её с основанием.',
  '',
  'Как пользоваться:',
  '1. Выберите коды точек, из которых состоит поверхность (чипы).',
  '2. Выберите основание. «Плоскость H» — горизонтальная плоскость на заданной отметке (куча на ровной площадке, дно котлована). «Съёмка «до»» — поверхность из тех же кодов с этапом «до работ».',
  '3. Проверьте макс. длину ребра и нажмите «Рассчитать».',
  '4. Получите объёмы отсыпки (поверхность выше основания) и срезки (ниже), площадь, число точек и треугольников и картинку треугольников.',
  '',
  'Как снимать: по низу кучи (подошве) и по всем перегибам — вершина, бровки, переломы откосов. На ровных склонах точки не реже, чем через 5 метров, на неровных чаще. Подошва обязательна: без неё объём занижается.',
  '',
  'Ограничения: нужна калибровка проекта; не больше 3000 точек. Считаются только места, где есть треугольники и у поверхности, и у основания.',
].join('\n');

const HELP_CODES = [
  'В поверхность «сверху» берутся точки выбранных кодов с этапом не «до». Для основания «Съёмка «до»» берутся точки тех же кодов с этапом «до».',
  'Лишние коды (репера, ось, ограждение) отключите, иначе они испортят поверхность.',
].join('\n');

const HELP_EDGE = [
  'Треугольники с ребром длиннее этого значения отбрасываются. Иначе программа затянет «плёнкой» пустоту между далёкими точками (например, внутри котлована или вокруг кучи).',
  'Обычно 20–30 м. Если часть поверхности пропала — значит, точки там реже, увеличьте значение.',
].join('\n');

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800', marginBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  chip: {
    paddingHorizontal: space.md, minHeight: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textPrimary, fontSize: font.small, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: font.caption, marginTop: space.sm },
});
