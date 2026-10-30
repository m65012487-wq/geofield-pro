import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { ScreenHelp } from '../src/components/Help';
import { Button, Card, QualityBadge } from '../src/components/ui';
import { MapCanvas } from '../src/components/MapCanvas';
import { colors, font, space } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useGnss } from '../src/lib/useGnss';
import { useCalibration, localOf } from '../src/lib/calibStore';
import { useRoad } from '../src/lib/roadCheck';
import { fmtPk, parsePk } from '../src/lib/road';
import { loadBasemap, type Basemap } from '../src/lib/basemap';
import { sectionTargets, sectionNavigation, slopeCheck, snapDxf, toleranceZone, SECTION_NAMES, type SectionKey, type SectionTarget, type SnapMode } from '../src/lib/stakeMath';
import { addPoint, kvGet, nextNameForCode } from '../src/db/database';
import { beep } from '../src/lib/feedback';

const HELP = `1. Загрузите ось и проектные кромки/бровки в «Трассе», выполните калибровку.
2. «Сечение»: введите пикет, нажмите «Применить». Выберите ось, кромку или бровку кнопкой или на схеме. Вперёд — по росту пикетажа, вправо — вправо по ходу оси.
3. Для ПГС/щебня задайте суммарную толщину слоёв НАД выносимым уровнем. Она вычитается вертикально из проектной отметки.
4. «Откос»: выберите бровку, насыпь/выемку и заложение 1:m. Перемещайте острие по земле наружу поперечника, пока Δ высоты не станет близко к нулю. Экран проверяет откос в текущем месте; рельеф вдали неизвестен.
5. «DXF»: выберите привязку и коснитесь линии на карте. Узел = вершина ломаной; середина = середина сегмента; пересечение = пересечение сегментов; ближайшая = точка на сегменте. Синяя линия — выбранный сегмент. По нему можно задать расстояние от начала и боковое смещение. Подложка двумерная: отметку задайте вручную, если она известна.
6. Зелёная зона — ближайший допуск, жёлтая/оранжевая — следующие зоны. Допуски меняются ниже. «Автоприближение» действует при включённом следовании позиции.
7. «Записать контроль» сохраняет измеренное положение с именем по пикету и отклонениями. Требуется свежий FIX; попадание в зону — только геометрический контроль, не оценка точности прибора.`;
const number = (s: string) => Number(s.trim().replace(',', '.'));
const ZCOL = [colors.fix, colors.warning, '#FF8C42', colors.textSecondary];

export default function RoadGuide() {
  const { project } = useActiveProject();
  const road = useRoad(project?.id);
  const calib = useCalibration(project?.id);
  const { position } = useGnss();
  const [mode, setMode] = useState<'section' | 'slope' | 'dxf'>('section');
  const [pk, setPk] = useState('0+00'), [station, setStation] = useState<number | null>(null);
  const [key, setKey] = useState<SectionKey>('AX');
  const [depth, setDepth] = useState('0'), [appliedDepth, setAppliedDepth] = useState(0);
  const [step, setStep] = useState('20'), [crossTol, setCrossTol] = useState('0.5');
  const [bands, setBands] = useState('0.05;0.5;1'), [autoZoom, setAutoZoom] = useState(true);
  const [ratio, setRatio] = useState('1.5'), [fill, setFill] = useState(true);
  const [pole, setPole] = useState(2), [bm, setBm] = useState<Basemap | null>(null);
  const [snapMode, setSnapMode] = useState<SnapMode>('node');
  const [snap, setSnap] = useState<ReturnType<typeof snapDxf>>(null);
  const [cadHeight, setCadHeight] = useState(''), [along, setAlong] = useState('0'), [offset, setOffset] = useState('0');
  const [cadTarget, setCadTarget] = useState<SectionTarget | null>(null);
  const [width, setWidth] = useState(320), [saving, setSaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const hit = useRef(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useFocusEffect(useCallback(() => {
    if (!project) return;
    loadBasemap(project.id).then(setBm);
    Promise.all([kvGet('antennaHeight'), kvGet('tiltByReceiver')]).then(([h, tilt]) => setPole(tilt === '1' ? 0 : Number.isFinite(Number(h)) && h != null ? Number(h) : 2));
  }, [project?.id]));
  useEffect(() => { setStation(null); setSnap(null); setCadTarget(null); hit.current = false; }, [road, project?.id]);
  const live = position && position.quality !== 'none' ? localOf(calib, position.latitude, position.longitude, position.elevation - pole) : null;
  const fresh = !!position && now - position.timestamp >= 0 && now - position.timestamp < 15000;
  const pts = (() => { try { return road && station != null ? sectionTargets(road, station, appliedDepth) : []; } catch { return []; } })();
  const target = mode === 'dxf' ? cadTarget : pts.find((p) => p.key === key) ?? null;
  const nav = target && live ? mode === 'dxf'
    ? { along: target.north - live.north, right: target.east - live.east, distance: Math.hypot(target.north - live.north, target.east - live.east), dh: target.h == null ? null : target.h - live.height }
    : road ? sectionNavigation(road, target, live) : null : null;
  const slope = mode === 'slope' && road && target && live ? slopeCheck(road, target, live, number(ratio), fill) : null;
  const ct = number(crossTol);
  const onSection = !!nav && Number.isFinite(ct) && ct > 0 && Math.abs(nav.along) <= ct;
  const zone = (() => { try { return nav ? toleranceZone(mode === 'slope' ? Math.abs(slope?.dh ?? Infinity) : nav.distance, bands.split(';').map(number)) : 3; } catch { return 3; } })();
  useEffect(() => {
    const yes = mode !== 'slope' && zone === 0 && fresh && position?.quality === 'fix' && (mode === 'dxf' || onSection);
    if (yes && !hit.current) beep('done');
    hit.current = yes;
  }, [zone, fresh, position?.quality, onSection, mode, target?.north, target?.east]);
  const apply = (s = parsePk(pk)) => {
    try {
      if (!road || s == null) throw new Error('Загрузите трассу и введите пикет');
      toleranceZone(0, bands.split(';').map(number));
      if (!(number(crossTol) > 0)) throw new Error('Допуск по сечению должен быть больше нуля');
      const points = sectionTargets(road, s, number(depth));
      setStation(s); setPk(fmtPk(s)); setAppliedDepth(number(depth));
      if (!points.some((p) => p.key === key)) setKey('AX');
    } catch (e) { Alert.alert('Проверьте параметры', String((e as Error).message)); }
  };
  const shiftPk = (direction: number) => { const delta = number(step); if (!(delta > 0)) return Alert.alert('Шаг', 'Введите положительный шаг'); const s = station ?? parsePk(pk); if (s != null) apply(s + direction * delta); };
  const selectSnap = (p: { north: number; east: number }, radius: number) => {
    if (!bm) return;
    try { const got = snapDxf(bm, p, radius, snapMode); if (!got) return Alert.alert('Привязка', 'Рядом нет подходящего элемента. Приблизьте карту.'); setSnap(got); setAlong('0'); setOffset('0'); setCadTarget({ ...got, s: 0, off: 0, key: 'AX', h: null }); } catch (e) { Alert.alert('Привязка', (e as Error).message); }
  };
  const applyCad = () => {
    if (!bm || !snap) return;
    const l = bm.lines[snap.line], j = snap.segment * 2;
    const dn = l.pts[j + 3] - l.pts[j + 1], de = l.pts[j + 2] - l.pts[j], len = Math.hypot(dn, de);
    const a = number(along), off = number(offset), h = cadHeight.trim() ? number(cadHeight) : null;
    if (!(len > 0) || !Number.isFinite(a) || !Number.isFinite(off) || (h != null && !Number.isFinite(h))) return Alert.alert('Параметры', 'Проверьте расстояние, смещение и отметку');
    if (a < 0 || a > len) return Alert.alert('Расстояние', `В пределах выбранного сегмента: 0–${len.toFixed(3)} м`);
    setCadTarget({ north: l.pts[j + 1] + a * dn / len - off * de / len, east: l.pts[j] + a * de / len + off * dn / len, s: a, off, h, key: 'AX' });
  };
  const mark = async () => {
    if (!project || !target || !nav || !live || !position || saving) return;
    if (!fresh || position.quality !== 'fix') return Alert.alert('Нужен FIX', 'Дождитесь свежего фиксированного решения');
    if (mode !== 'dxf' && !onSection) return Alert.alert('Вне сечения', 'Вернитесь в допуск вдоль оси');
    const storePoint = async () => {
      if (Date.now() - position.timestamp >= 15000) return Alert.alert('Позиция устарела', 'Повторите контроль по свежему FIX');
      setSaving(true);
      try {
        const base = mode === 'dxf' ? 'DXF' : `ПК${fmtPk(target.s)}_${mode === 'slope' ? 'ОТК' : target.key}`;
        const name = await nextNameForCode(project.id, base + '_');
        await addPoint({ projectId: project.id, name, code: mode === 'dxf' ? 'VYN_DXF' : 'VYN', latitude: position.latitude, longitude: position.longitude, elevation: position.elevation - pole, north: live.north, east: live.east, height: live.height, quality: position.quality, hAccuracy: position.hAccuracy, vAccuracy: position.vAccuracy, epochs: 1, stage: '', note: `Контроль ${mode}; цель N=${target.north.toFixed(3)} E=${target.east.toFixed(3)}; ΔH=${(mode === 'slope' ? slope?.dh : nav.dh)?.toFixed(3) ?? 'нет'}; расстояние=${nav.distance.toFixed(3)}; слой=${appliedDepth}` });
        beep('done'); Alert.alert('Контроль записан', name);
      } catch (e) { Alert.alert('Не записалось', (e as Error).message); } finally { setSaving(false); }
    };
    if (mode === 'slope' && !slope) return Alert.alert('Откос', 'Выберите бровку с отметкой, задайте 1:m и выйдите наружу');
    if (zone !== 0 || position.hAccuracy > 0.05 || (mode === 'slope' && Math.abs(slope?.dh ?? Infinity) > 0.05)) Alert.alert('Контроль с отклонением', 'Положение или точность вне 5 см. Сохранить измеренное положение для отчёта?', [{ text: 'Отмена' }, { text: 'Записать', onPress: storePoint }]);
    else await storePoint();
  };
  const field = (label: string, value: string, set: (s: string) => void) => <View><Text style={shared.label}>{label}</Text><TextInput style={shared.input} value={value} onChangeText={set} autoCapitalize="none" /></View>;
  const chart = pts.filter((p) => p.h != null);
  const chartHeight = (off: number, h: number) => {
    const lo = Math.min(...chart.map((p) => p.off)), hi = Math.max(...chart.map((p) => p.off));
    const bottom = Math.min(...chart.map((p) => p.h!)), top = Math.max(...chart.map((p) => p.h!));
    return { x: 22 + (off - lo) / Math.max(1, hi - lo) * (width - 44), y: 120 - (h - bottom) / Math.max(0.1, top - bottom) * 70 };
  };
  return <ScrollView style={shared.container} contentContainerStyle={shared.pad} keyboardShouldPersistTaps="handled">
    <ScreenHelp title="Вынос для дороги" text={HELP} />
    {!project && <Text style={shared.muted}>Выберите проект</Text>}
    <View style={styles.row}>{(['section', 'slope', 'dxf'] as const).map((m) => <Pressable key={m} onPress={() => setMode(m)} style={[styles.chip, mode === m && styles.active]}><Text style={styles.text}>{m === 'section' ? 'Сечение' : m === 'slope' ? 'Откос' : 'DXF'}</Text></Pressable>)}</View>
    {mode !== 'dxf' && <Card>
      <Text style={styles.text}>{road?.name ?? 'Сначала загрузите ось в «Трассе»'}</Text>
      {field('Пикет (12+40)', pk, setPk)}{field('Сумма слоёв над уровнем, м', depth, setDepth)}
      <Button label="Применить пикет и слой" onPress={() => apply()} style={{ marginTop: 12 }} />
      {field('Шаг пикетов, м', step, setStep)}
      <View style={styles.row}><Button label="← ПК" onPress={() => shiftPk(-1)} variant="secondary" /><Button label="ПК →" onPress={() => shiftPk(1)} variant="secondary" /></View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {chart.length > 0 && <Svg width={width} height={175}><Polyline points={chart.map((p) => { const c = chartHeight(p.off, p.h!); return `${c.x},${c.y}`; }).join(' ')} stroke={colors.accent} fill="none" strokeWidth={2} />{chart.map((p) => { const c = chartHeight(p.off, p.h!); return <React.Fragment key={p.key}><Circle cx={c.x} cy={c.y} r={key === p.key ? 10 : 6} fill={key === p.key ? colors.fix : colors.accent} onPress={() => setKey(p.key)} /><SvgText x={c.x} y={c.y - 16} textAnchor="middle" fill={colors.textPrimary} fontSize={11}>{p.key}</SvgText><Line x1={c.x} x2={c.x} y1={c.y + 8} y2={145} stroke={colors.border} /></React.Fragment>; })}</Svg>}
      </View>
      <Text style={shared.muted}>Схема сечения: вертикальный масштаб увеличен</Text>
      <View style={styles.row}>{pts.map((p) => <Pressable key={p.key} onPress={() => setKey(p.key)} style={[styles.chip, key === p.key && styles.active]}><Text style={styles.text}>{SECTION_NAMES[p.key]}</Text></Pressable>)}</View>
      {mode === 'slope' && <><Text style={shared.muted}>Выберите бровку слева или справа. Контроль откоса по земле под остриём.</Text>{field('Заложение 1:m', ratio, setRatio)}<Button label={fill ? 'Насыпь: вниз наружу' : 'Выемка: вверх наружу'} variant="secondary" onPress={() => setFill(!fill)} /></>}
    </Card>}
    {mode === 'dxf' && <Card>
      <Text style={styles.text}>{bm?.name ?? 'Загрузите подложку DXF'}</Text>
      <View style={styles.row}>{(['node', 'mid', 'intersection', 'nearest'] as SnapMode[]).map((m) => <Pressable key={m} onPress={() => setSnapMode(m)} style={[styles.chip, m === snapMode && styles.active]}><Text style={styles.text}>{{ node: 'Узел', mid: 'Середина', intersection: 'Пересечение', nearest: 'Ближайшая' }[m]}</Text></Pressable>)}</View>
      {snap && <Text style={shared.muted}>Сегмент {snap.segment + 1}, линия {snap.line + 1}. Касание выбрало цель без высоты.</Text>}
      {field('Проектная отметка DXF (пусто — без высоты)', cadHeight, setCadHeight)}
      {field('От начала выбранного сегмента, м', along, setAlong)}{field('Смещение вправо от направления сегмента, м', offset, setOffset)}
      <Button label="Цель по сегменту и отметке" onPress={applyCad} disabled={!snap} />
    </Card>}
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ marginTop: 12 }}><MapCanvas width={width} height={300} here={live} target={target} points={target ? [{ ...target, id: 'goal', name: 'Цель' }] : []} basemap={bm} autoApproach={autoZoom} onTapWorld={mode === 'dxf' ? (p, mpp) => selectSnap(p, mpp * 24) : undefined} lines={mode === 'dxf' && snap && bm ? [{ color: '#4BC0F9', pts: bm.lines[snap.line].pts.slice(snap.segment * 2, snap.segment * 2 + 4) }] : undefined} /></View>
    <Card style={{ marginTop: 12 }}>
      <QualityBadge quality={position?.quality ?? 'none'} />
      {!fresh && <Text style={styles.warning}>Нет свежей позиции</Text>}
      {nav && <>
        <Text style={[styles.big, { color: ZCOL[zone] }]}>{mode === 'slope' ? `Δ откоса ${slope ? (slope.dh * 100).toFixed(1) : '—'} см` : `${nav.distance.toFixed(3)} м до цели`}</Text>
        <Text style={styles.big}>{mode === 'dxf' ? 'На север' : 'Вперёд по оси'} {nav.along.toFixed(3)} м</Text>
        <Text style={styles.big}>{mode === 'dxf' ? 'На восток' : 'Вправо по оси'} {nav.right.toFixed(3)} м</Text>
        {mode !== 'dxf' && !onSection && <Text style={styles.warning}>Вне сечения: {Math.abs(nav.along).toFixed(2)} м вдоль оси</Text>}
        {(mode === 'slope' ? slope?.dh : nav.dh) != null && <Text style={styles.big}>{((mode === 'slope' ? slope!.dh : nav.dh!) >= 0 ? 'Насыпать' : 'Срезать')} {Math.abs((mode === 'slope' ? slope!.dh : nav.dh!) * 100).toFixed(1)} см</Text>}
        {mode === 'slope' && !slope && <Text style={styles.warning}>Выберите бровку с проектной высотой и выйдите наружу от неё</Text>}
        {target?.h != null && <Text style={shared.muted}>H цели {target.h.toFixed(3)} м · вычтено слоёв {appliedDepth.toFixed(3)} м</Text>}
      </>}
      {!live && <Text style={shared.muted}>Для навигации нужны связь с приёмником и калибровка.</Text>}
      <Button label="Записать контроль" onPress={mark} loading={saving} disabled={!target || !live} style={{ marginTop: 12 }} />
    </Card>
    <Card style={{ marginTop: 12 }}>{field('Допуск ухода с сечения, м', crossTol, setCrossTol)}{field('Три зоны допуска, м (через ;)', bands, setBands)}<View style={styles.row}><Text style={styles.text}>Автоприближение</Text><Switch value={autoZoom} onValueChange={setAutoZoom} /></View><Text style={shared.muted}>Зелёный / жёлтый / оранжевый. Во время перемещения карты вручную масштаб остаётся вашим.</Text></Card>
  </ScrollView>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginVertical: 10 }, chip: { padding: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border }, active: { borderColor: colors.accent, backgroundColor: colors.accentBg }, text: { color: colors.textPrimary, fontSize: font.body }, big: { color: colors.textPrimary, fontSize: 25, fontWeight: '800', marginTop: 8, fontVariant: ['tabular-nums'] }, warning: { color: colors.warning, fontSize: font.bodyLg, marginVertical: 8 } });
