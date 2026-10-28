import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, Pressable, Modal, FlatList } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { HelpButton, ScreenHelp } from '../src/components/Help';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useCalibration, localOf } from '../src/lib/calibStore';
import { addFeature, deleteFeature, listFeatures, listPoints } from '../src/db/database';
import type { Feature, SurveyPoint } from '../src/db/types';
import { sanitizeName, shareFile, writeCacheFile } from '../src/lib/exporter';

const CRLF = String.fromCharCode(13, 10);
const BOM = String.fromCharCode(0xfeff);
const TRUBA = 'TRUBA';

/** Запятая в дробях — как в ведомостях проекта (Excel с русскими настройками). */
const csvN = (v: number | null | undefined, d: number) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d).replace('.', ','));
const fmt = (v: number, d: number) => v.toFixed(d).replace('.', ',');
const num = (s: string) => parseFloat(s.replace(',', '.').trim());

interface End { n: number; e: number; h: number }

interface PipeCalc {
  plan: number;
  slant: number;
  /** H(A) − H(B): положительное — вода идёт от A к B. */
  dh: number;
  /** Уклон в направлении A→B со знаком, ‰. */
  slopeAB: number;
  /** Модуль уклона, ‰. */
  slope: number;
  /** Сток от A к B. */
  AtoB: boolean;
}

function calcPipe(a: End, b: End): PipeCalc {
  const plan = Math.hypot(b.n - a.n, b.e - a.e);
  const dh = a.h - b.h;
  const slopeAB = plan > 0 ? (dh / plan) * 1000 : 0;
  return { plan, slant: Math.hypot(plan, dh), dh, slopeAB, slope: Math.abs(slopeAB), AtoB: dh >= 0 };
}

function pointEnd(p: SurveyPoint, calib: ReturnType<typeof useCalibration>): End | null {
  if (p.north != null && p.east != null && p.height != null) return { n: p.north, e: p.east, h: p.height };
  const l = localOf(calib, p.latitude, p.longitude, p.elevation);
  return l ? { n: l.north, e: l.east, h: l.height } : null;
}

interface SavedPipe { f: Feature; calc: PipeCalc | null }

/**
 * Труба: два торца (точки проекта) → длина, наклонная длина, ΔH, уклон и направление стока,
 * сверка с проектным уклоном; сохранение как линия TRUBA и ведомость труб в CSV.
 */
export default function PipeScreen() {
  const { project } = useActiveProject();
  const calib = useCalibration(project?.id);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const [picking, setPicking] = useState<'A' | 'B' | null>(null);
  const [design, setDesign] = useState('');
  const [tol, setTol] = useState('2');
  const [minSlope, setMinSlope] = useState('5');
  const [saved, setSaved] = useState<Feature[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!project) return;
    const pts = await listPoints(project.id);
    setPoints(pts);
    // по умолчанию — две последние точки: A предыдущая, B последняя
    setAId((cur) => (cur && pts.some((p) => p.id === cur) ? cur : pts[1]?.id ?? null));
    setBId((cur) => (cur && pts.some((p) => p.id === cur) ? cur : pts[0]?.id ?? null));
    setSaved((await listFeatures(project.id, 'line')).filter((f) => f.code === TRUBA && f.vertices.length === 2));
  }, [project?.id]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const pa = points.find((p) => p.id === aId) ?? null;
  const pb = points.find((p) => p.id === bId) ?? null;
  const ea = pa ? pointEnd(pa, calib) : null;
  const eb = pb ? pointEnd(pb, calib) : null;
  const calc = ea && eb ? calcPipe(ea, eb) : null;

  const designV = num(design);
  const tolV = Number.isFinite(num(tol)) ? Math.abs(num(tol)) : 0;
  const minV = Number.isFinite(num(minSlope)) ? Math.abs(num(minSlope)) : 0;

  const check = useMemo(() => {
    if (!calc) return null;
    const warns: string[] = [];
    const hasDesign = Number.isFinite(designV);
    if (hasDesign && designV > 0 && calc.slopeAB < 0) warns.push('Уклон обратный проектному: вода идёт от B к A');
    if (calc.slope < minV) warns.push(`Уклон ${fmt(calc.slope, 1)} ‰ меньше минимального ${fmt(minV, 1)} ‰`);
    let inTol: boolean | null = null;
    if (hasDesign) inTol = Math.abs(calc.slopeAB - designV) <= tolV;
    return { warns, inTol, diff: hasDesign ? calc.slopeAB - designV : null };
  }, [calc, designV, tolV, minV]);

  const names = pa && pb ? `${pa.name}–${pb.name}` : '';

  const save = async () => {
    if (!project || !pa || !pb) return;
    setBusy(true);
    try {
      await addFeature({
        projectId: project.id, type: 'line', code: TRUBA, name: `Труба ${names}`,
        vertices: [
          { lat: pa.latitude, lon: pa.longitude, elev: pa.elevation },
          { lat: pb.latitude, lon: pb.longitude, elev: pb.elevation },
        ],
      });
      await reload();
      Alert.alert('Сохранено', `Труба ${names} добавлена в «Линии и полигоны».`);
    } catch (e) {
      Alert.alert('Не удалось сохранить', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rows: SavedPipe[] = useMemo(() => saved.map((f) => {
    const [v0, v1] = f.vertices;
    const l0 = localOf(calib, v0.lat, v0.lon, v0.elev);
    const l1 = localOf(calib, v1.lat, v1.lon, v1.elev);
    const calcP = l0 && l1 ? calcPipe({ n: l0.north, e: l0.east, h: l0.height }, { n: l1.north, e: l1.east, h: l1.height }) : null;
    return { f, calc: calcP };
  }), [saved, calib]);

  const total = rows.reduce((s, r) => s + (r.calc?.plan ?? 0), 0);

  const remove = (f: Feature) => {
    if (!project) return;
    Alert.alert('Удалить трубу?', f.name, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => { await deleteFeature(f.id, project.id); reload(); } },
    ]);
  };

  const exportCsv = async () => {
    if (!project) return;
    try {
      const out: string[] = [];
      out.push(`Ведомость труб;${project.name}`);
      out.push(`Сформировано ${new Date().toLocaleString('ru-RU')}`);
      out.push('');
      out.push('№;Труба;Длина в плане, м;Наклонная длина, м;ΔH, м;Уклон, ‰;Уклон, %;Сток');
      rows.forEach((r, k) => {
        const c = r.calc;
        out.push([
          k + 1, r.f.name, csvN(c?.plan, 2), csvN(c?.slant, 2), csvN(c ? Math.abs(c.dh) : null, 3),
          csvN(c?.slope, 1), csvN(c ? c.slope / 10 : null, 2), c ? (c.AtoB ? 'от первой точки ко второй' : 'от второй точки к первой') : '',
        ].join(';'));
      });
      out.push(['', 'Итого', csvN(total, 2), '', '', '', '', ''].join(';'));
      const f = writeCacheFile(`${sanitizeName(project.name)}_трубы.csv`, BOM + out.join(CRLF) + CRLF);
      await shareFile(f, 'text/csv', 'Ведомость труб');
    } catch (e) {
      Alert.alert('Не удалось выгрузить', e instanceof Error ? e.message : String(e));
    }
  };

  if (!project) {
    return <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}><Text style={shared.muted}>Сначала выберите проект.</Text></View>;
  }

  const endLabel = (p: SurveyPoint | null) => (p ? `${p.name}${p.code ? ` · ${p.code}` : ''}` : 'не выбрана');

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <ScreenHelp title="Труба" text={HELP} />

      <Card>
        <Text style={styles.title}>Торцы трубы</Text>
        <Pressable style={styles.pick} onPress={() => setPicking('A')}>
          <Text style={styles.pickKey}>A</Text>
          <Text style={styles.pickVal}>{endLabel(pa)}</Text>
        </Pressable>
        <Pressable style={styles.pick} onPress={() => setPicking('B')}>
          <Text style={styles.pickKey}>B</Text>
          <Text style={styles.pickVal}>{endLabel(pb)}</Text>
        </Pressable>
        {points.length < 2 && <Text style={[shared.muted, { marginTop: space.sm }]}>В проекте нужно минимум две точки.</Text>}
        {pa && pb && !calc && (
          <Text style={styles.warn}>У точек нет местных координат — сначала калибровка проекта.</Text>
        )}
      </Card>

      <Card style={{ marginTop: space.lg }}>
        <View style={shared.row}>
          <Text style={[styles.title, { flex: 1, marginBottom: 0 }]}>Проектный уклон</Text>
          <HelpButton size={20} title="Проектный уклон" text={HELP_DESIGN} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Field label="Проектный, ‰" value={design} onChange={setDesign} placeholder="например 10" />
          <Field label="Допуск, ±‰" value={tol} onChange={setTol} />
          <Field label="Минимальный, ‰" value={minSlope} onChange={setMinSlope} />
        </View>
      </Card>

      {calc && check && (
        <View style={shared.resultBox}>
          <Row k="Длина в плане" v={`${fmt(calc.plan, 2)} м`} />
          <Row k="Наклонная длина" v={`${fmt(calc.slant, 2)} м`} />
          <Row k="ΔH (A − B)" v={`${calc.dh >= 0 ? '+' : '−'}${fmt(Math.abs(calc.dh), 3)} м`} />
          <Row k="Уклон" v={`${fmt(calc.slope, 1)} ‰  (${fmt(calc.slope / 10, 2)} %)`} />
          <Row k="Сток" v={calc.slope < 0.05 ? 'горизонтально' : calc.AtoB ? `от A к B (${pa?.name} → ${pb?.name})` : `от B к A (${pb?.name} → ${pa?.name})`} />
          {check.inTol != null && (
            <Text style={[styles.verdict, { color: check.inTol ? colors.success : colors.danger }]}>
              {check.inTol ? 'В допуске' : 'Не в допуске'}: проект {fmt(designV, 1)} ‰, факт {fmt(calc.slopeAB, 1)} ‰
              {check.diff != null ? ` (${check.diff >= 0 ? '+' : '−'}${fmt(Math.abs(check.diff), 1)} ‰)` : ''}
            </Text>
          )}
          {check.warns.map((w) => (
            <View key={w} style={styles.alert}><Text style={styles.alertText}>⚠ {w}</Text></View>
          ))}
        </View>
      )}

      <Button label="Сохранить трубу" onPress={save} disabled={!pa || !pb || pa.id === pb.id} loading={busy} style={{ marginTop: space.lg }} />

      <Card style={{ marginTop: space.xl }}>
        <Text style={styles.title}>Сохранённые трубы ({rows.length})</Text>
        {rows.length === 0 && <Text style={shared.muted}>Пока нет. Сохранённые трубы — линии с кодом TRUBA.</Text>}
        {rows.map((r, k) => (
          <Pressable key={r.f.id} onLongPress={() => remove(r.f)} style={styles.item}>
            <Text style={styles.itemName}>{k + 1}. {r.f.name}</Text>
            <Text style={styles.itemVal}>
              {r.calc ? `L ${fmt(r.calc.plan, 2)} м · ${fmt(r.calc.slope, 1)} ‰` : 'нет калибровки'}
            </Text>
          </Pressable>
        ))}
        {rows.length > 0 && (
          <>
            <Text style={styles.total}>Итого длина: {fmt(total, 2)} м</Text>
            <Text style={styles.hint}>Удалить трубу — долгое нажатие на строке.</Text>
            <Button label="CSV списка труб" variant="secondary" onPress={exportCsv} style={{ marginTop: space.md }} />
          </>
        )}
      </Card>

      <PointPicker
        visible={picking != null}
        title={picking === 'A' ? 'Торец A' : 'Торец B'}
        points={points}
        onClose={() => setPicking(null)}
        onPick={(p) => { if (picking === 'A') setAId(p.id); else setBId(p.id); setPicking(null); }}
      />
    </ScrollView>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={shared.label}>{label}</Text>
      <TextInput style={shared.input} value={value} onChangeText={onChange} placeholder={placeholder}
        placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" />
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
      <Text style={shared.resultLabel}>{k}</Text>
      <Text style={[styles.rowVal, shared.mono]}>{v}</Text>
    </View>
  );
}

/** Модальный выбор точки с поиском по имени и коду. */
function PointPicker({ visible, title, points, onClose, onPick }: {
  visible: boolean; title: string; points: SurveyPoint[]; onClose: () => void; onPick: (p: SurveyPoint) => void;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? points.filter((p) => p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)) : points;
  }, [points, q]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={shared.modalOverlay}>
        <View style={[shared.modalSheet, { maxHeight: '85%' }]}>
          <Text style={shared.modalTitle}>{title}</Text>
          <TextInput style={shared.input} value={q} onChangeText={setQ} placeholder="Поиск по имени или коду"
            placeholderTextColor={colors.textMuted} autoCapitalize="none" />
          <FlatList
            style={{ marginTop: space.sm }}
            data={list}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={shared.muted}>Ничего не найдено.</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.item} onPress={() => onPick(item)}>
                <Text style={styles.itemName}>{item.name}{item.code ? ` · ${item.code}` : ''}</Text>
                <Text style={styles.itemVal}>{item.height != null ? `H ${fmt(item.height, 3)}` : `h ${fmt(item.elevation, 3)}`}</Text>
              </Pressable>
            )}
          />
          <Button label="Закрыть" variant="secondary" onPress={onClose} style={{ marginTop: space.md }} />
        </View>
      </View>
    </Modal>
  );
}

const HELP = [
  'Считает длину и уклон трубы по двум торцам — точкам, снятым на лотках или на краях трубы.',
  '',
  'Как пользоваться:',
  '1. Нажмите на строку A и B и выберите точки из проекта (поиск по имени или коду). По умолчанию взяты две последние снятые точки.',
  '2. Экран покажет длину в плане, наклонную длину, разницу высот ΔH, уклон в ‰ и %, и куда течёт вода (от высокой точки к низкой).',
  '3. Если есть проектный уклон — впишите его в ‰ и допуск: появится «В допуске» или «Не в допуске».',
  '4. «Сохранить трубу» запишет линию с кодом TRUBA (имя «Труба A–B»); она появится в «Линиях и полигонах» и в списке ниже.',
  '5. «CSV списка труб» выгружает ведомость для Excel с итогом длины.',
  '',
  'Красное предупреждение: уклон обратный проектному или меньше минимального (по умолчанию 5 ‰).',
  '',
  'Нужна калибровка проекта — без неё у точек нет местных координат и высот. Проектный уклон задаётся в направлении от A к B.',
].join('\n');

const HELP_DESIGN = [
  'Проектный уклон — в промилле (‰): 10 ‰ = 1 % = 1 см на метр. Направление проектного стока — от A к B; если вода по факту идёт обратно, будет предупреждение.',
  '',
  'Допуск — на сколько ‰ факт может отличаться от проекта.',
  'Минимальный — ниже этого уклона труба считается слишком пологой (по умолчанию 5 ‰). Пустое проектное поле — проверяется только минимальный.',
].join('\n');

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800', marginBottom: space.sm },
  pick: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm,
    backgroundColor: colors.surfaceRaised, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: space.md, minHeight: 56,
  },
  pickKey: { color: colors.accent, fontSize: font.title, fontWeight: '900', width: 24 },
  pickVal: { color: colors.textPrimary, fontSize: font.body, flex: 1 },
  warn: { color: colors.warning, fontSize: font.small, marginTop: space.sm },
  rowVal: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  verdict: { fontSize: font.body, fontWeight: '800', marginTop: space.sm },
  alert: { backgroundColor: colors.dangerBg, borderColor: colors.danger, borderWidth: 1, borderRadius: radius.md, padding: space.md },
  alertText: { color: colors.danger, fontSize: font.body, fontWeight: '700' },
  item: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  itemName: { color: colors.textPrimary, fontSize: font.body, flexShrink: 1 },
  itemVal: { color: colors.textSecondary, fontSize: font.small },
  total: { color: colors.accent, fontSize: font.bodyLg, fontWeight: '800', marginTop: space.md },
  hint: { color: colors.textMuted, fontSize: font.caption, marginTop: space.xs },
});
