import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ScrollView, Alert, Switch } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button } from '../src/components/ui';
import { useActiveProject } from '../src/lib/useActiveProject';
import { kvGet, kvSet, listCodes, listPoints } from '../src/db/database';
import type { FeatureCode, SurveyPoint } from '../src/db/types';
import { fmtPk } from '../src/lib/road';
import {
  analyse, coverage, isBefore, loadRoadSettings, sections, slopes, useRoad, volumes,
  DEFAULT_ROAD_SETTINGS, type RoadSettings,
} from '../src/lib/roadCheck';
import { loadShotSettings } from '../src/lib/useShot';
import { schemeDxf, sendDay, vedomostCsv } from '../src/lib/roadExport';
import { sanitizeName, shareFile, writeCacheFile } from '../src/lib/exporter';

type Tab = 'pts' | 'slope' | 'cover' | 'vol';
const TABS: Array<[Tab, string]> = [['pts', 'Точки'], ['slope', 'Уклоны'], ['cover', 'Полнота'], ['vol', 'Объёмы']];
const DEFAULT_VOL = ['OTK', 'KUV', 'OBL', 'OBP'];

/**
 * Ведомость по пикетам прямо в поле: каждая точка с пикетом, смещением, отклонением от проекта и толщиной;
 * уклоны по поперечникам; таблица «пикет × объект» — чего не хватает; объёмы по съёмкам «до» и «после».
 */
export default function VedomostScreen() {
  const router = useRouter();
  const { project } = useActiveProject();
  const road = useRoad(project?.id);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [codes, setCodes] = useState<FeatureCode[]>([]);
  const [set, setSet] = useState<RoadSettings>(DEFAULT_ROAD_SETTINGS);
  const [seq, setSeq] = useState<string[]>(['OBL', 'DOR', 'OBP']);
  const [tab, setTab] = useState<Tab>('pts');
  const [onlyBad, setOnlyBad] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [covCodes, setCovCodes] = useState<string[]>([]);
  const [volCodes, setVolCodes] = useState<string[]>(DEFAULT_VOL);
  const [busy, setBusy] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    if (!project) return;
    listPoints(project.id).then(setPoints);
    listCodes().then(setCodes);
    loadRoadSettings().then(setSet);
    loadShotSettings().then((s) => setSeq(s.seq));
    kvGet('covCodes').then((v) => setCovCodes(v ? v.split(',').filter(Boolean) : []));
    kvGet('volCodes').then((v) => v && setVolCodes(v.split(',').filter(Boolean)));
  }, [project?.id]));

  const rows = useMemo(() => (road ? analyse(road, points, set) : []), [road, points, set]);
  const secs = useMemo(() => sections(rows, set.secTol), [rows, set.secTol]);
  const sl = useMemo(() => slopes(secs, seq, set.tolSlope), [secs, seq, set.tolSlope]);
  const cov = useMemo(() => coverage(rows, covCodes.length ? covCodes : seq, set), [rows, covCodes, seq, set]);
  const vol = useMemo(() => volumes(rows, volCodes, set), [rows, volCodes, set]);

  if (!project) {
    return <View style={[shared.container, styles.center]}><Text style={shared.muted}>Сначала выберите проект.</Text></View>;
  }
  if (!road) {
    return (
      <View style={[shared.container, styles.center]}>
        <Text style={styles.empty}>Трасса не загружена</Text>
        <Text style={[shared.muted, { textAlign: 'center' }]}>Пикет, смещение и сравнение с проектом считаются по оси проекта.</Text>
        <Button label="Загрузить ось" onPress={() => router.push('/road')} style={{ marginTop: space.lg, minWidth: 220 }} />
      </View>
    );
  }

  const placed = rows.filter((r) => r.st);
  const withDesign = placed.filter((r) => r.dh != null);
  const bad = withDesign.filter((r) => !r.ok).length;

  const toggleCode = (list: string[], c: string, key: string, setter: (v: string[]) => void) => {
    const next = list.includes(c) ? list.filter((x) => x !== c) : [...list, c];
    setter(next);
    kvSet(key, next.join(','));
  };

  const doExport = async (kind: 'csv' | 'dxf' | 'day') => {
    setBusy(kind);
    try {
      const base = sanitizeName(project.name);
      if (kind === 'csv') {
        const f = writeCacheFile(`${base}_ведомость.csv`, vedomostCsv(project, rows, seq, set, volCodes));
        await shareFile(f, 'text/csv', 'Ведомость');
      } else if (kind === 'dxf') {
        const f = writeCacheFile(`${base}_схема.dxf`, schemeDxf(project, road, rows, codes, seq, set));
        await shareFile(f, 'application/dxf', 'Схема DXF');
      } else {
        Alert.alert('Отправлено', await sendDay(project, points, road, codes, seq, set, volCodes));
      }
    } catch (e) {
      Alert.alert('Не получилось', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={shared.container}>
      <View style={styles.summary}>
        <Text style={styles.sumT}>
          {placed.length} точек на трассе · с проектом {withDesign.length} · вне допуска{' '}
          <Text style={{ color: bad ? colors.danger : colors.fix }}>{bad}</Text>
          {cov.stations.length ? ` · не хватает ${cov.missing}` : ''}
        </Text>
        {rows.length > placed.length && (
          <Text style={styles.sumW}>{rows.length - placed.length} без местных координат (не было калибровки)</Text>
        )}
      </View>

      <View style={styles.tabs}>
        {TABS.map(([k, t]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]}>
            <Text style={[styles.tabT, tab === k && styles.tabTOn]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'pts' && (
        <>
          <View style={styles.filter}>
            <Text style={styles.filterT}>Только вне допуска</Text>
            <Switch value={onlyBad} onValueChange={setOnlyBad} />
          </View>
          <FlatList
            data={placed.filter((r) => !onlyBad || r.ok === false)}
            keyExtractor={(r) => r.p.id}
            ListHeaderComponent={<Head cols={['ПК', 'смещ.', 'точка', 'H факт', 'Δ мм', 'толщ.']} />}
            renderItem={({ item: r }) => (
              <View style={[styles.tr, isBefore(r.p) && { opacity: 0.55 }]}>
                <Text style={[styles.td, { flex: 1.3 }]}>{fmtPk(r.st!.s, 1)}{r.st!.outside ? '*' : ''}</Text>
                <Text style={styles.td}>{r.st!.off >= 0 ? '+' : ''}{r.st!.off.toFixed(2)}</Text>
                <Text style={[styles.td, { flex: 1.2 }]} numberOfLines={1}>{r.p.name}{isBefore(r.p) ? ' (до)' : ''}</Text>
                <Text style={[styles.td, { flex: 1.3 }]}>{(r.p.height ?? 0).toFixed(3)}</Text>
                <Text style={[styles.td, { color: r.ok == null ? colors.textMuted : r.ok ? colors.fix : colors.danger, fontWeight: '800' }]}>
                  {r.dh == null ? '—' : `${r.dh >= 0 ? '+' : ''}${r.dh.toFixed(0)}`}
                </Text>
                <Text style={styles.td}>{r.thick == null ? '' : r.thick.toFixed(0)}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.none}>Нет точек на трассе.</Text>}
            contentContainerStyle={{ paddingBottom: 130 }}
          />
        </>
      )}

      {tab === 'slope' && (
        <FlatList
          data={sl}
          keyExtractor={(s) => String(s.s)}
          ListHeaderComponent={<>
            <Text style={styles.hint}>Поперечник: {seq.slice(0, 3).join(' – ')} (середина — {seq[1]}). ‰ от середины наружу, проект в скобках, допуск ±{set.tolSlope} ‰.</Text>
            <Head cols={['ПК', 'слева ‰', 'справа ‰']} />
          </>}
          renderItem={({ item: s }) => (
            <View style={styles.tr}>
              <Text style={[styles.td, { flex: 1.2 }]}>{fmtPk(s.s, 1)}</Text>
              {[s.left, s.right].map((x, k) => (
                <Text key={k} style={[styles.td, { flex: 1.5, color: x?.ok === false ? colors.danger : x?.ok ? colors.fix : colors.textPrimary }]}>
                  {x ? `${x.fact.toFixed(1)}${x.design != null ? ` (${x.design.toFixed(1)})` : ''}` : '—'}
                </Text>
              ))}
            </View>
          )}
          ListEmptyComponent={<Text style={styles.none}>Нет поперечников с {seq[1]} и обочинами. Включите «⟳ поперечник» на съёмке.</Text>}
          contentContainerStyle={{ paddingBottom: 130 }}
        />
      )}

      {tab === 'cover' && (
        <>
          <CodeChips codes={codes} on={covCodes.length ? covCodes : seq} onToggle={(c) => toggleCode(covCodes.length ? covCodes : seq, c, 'covCodes', setCovCodes)} />
          <View style={styles.filter}>
            <Text style={styles.filterT}>Только пикеты с пропусками · шаг {set.pkStep} м, ±{set.secTol} м</Text>
            <Switch value={onlyMissing} onValueChange={setOnlyMissing} />
          </View>
          <FlatList
            data={cov.stations.map((s, i) => ({ s, have: cov.have[i] })).filter((x) => !onlyMissing || x.have.some((h) => !h))}
            keyExtractor={(x) => String(x.s)}
            ListHeaderComponent={<Head cols={['ПК', ...cov.codes]} />}
            renderItem={({ item: x }) => (
              <View style={styles.tr}>
                <Text style={[styles.td, { flex: 1.2 }]}>{fmtPk(x.s, 0)}</Text>
                {x.have.map((h, k) => (
                  <Text key={k} style={[styles.td, styles.cell, { color: h ? colors.fix : colors.danger }]}>{h ? '✓' : '✗'}</Text>
                ))}
              </View>
            )}
            ListEmptyComponent={<Text style={styles.none}>{cov.stations.length ? 'Пропусков нет 👍' : 'Нет точек на трассе.'}</Text>}
            contentContainerStyle={{ paddingBottom: 130 }}
          />
        </>
      )}

      {tab === 'vol' && (
        <>
          <CodeChips codes={codes} on={volCodes} onToggle={(c) => toggleCode(volCodes, c, 'volCodes', setVolCodes)} />
          <FlatList
            data={vol.rows}
            keyExtractor={(r) => String(r.s)}
            ListHeaderComponent={<>
              <Text style={styles.hint}>
                Съёмка «до» и «после» тех же объектов (переключатель «Этап» на съёмке). Площадь на поперечнике — между
                профилями, на стороне нужно ≥ 2 точек в обеих съёмках. Объём — по средним площадям, разрыв больше 50 м не мостится.
              </Text>
              <Text style={styles.total}>Отсыпка {vol.fill.toFixed(2)} м³ · срезка {vol.cut.toFixed(2)} м³</Text>
              <Head cols={['ПК', 'S+ лев', 'S+ прав', 'S− ', 'V+ м³', 'V− м³']} />
            </>}
            renderItem={({ item: r }) => (
              <View style={styles.tr}>
                <Text style={[styles.td, { flex: 1.2 }]}>{fmtPk(r.s, 1)}</Text>
                <Text style={styles.td}>{r.fillL.toFixed(2)}</Text>
                <Text style={styles.td}>{r.fillR.toFixed(2)}</Text>
                <Text style={styles.td}>{(r.cutL + r.cutR).toFixed(2)}</Text>
                <Text style={styles.td}>{r.vFill.toFixed(1)}</Text>
                <Text style={styles.td}>{r.vCut.toFixed(1)}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.none}>
              {points.some(isBefore) ? 'Нет поперечников, где есть обе съёмки выбранных объектов.' : 'Нет съёмки «до». На съёмке переключите «Этап» на ДО, снимите, потом ПОСЛЕ.'}
            </Text>}
            contentContainerStyle={{ paddingBottom: 130 }}
          />
        </>
      )}

      <View style={styles.bar}>
        <Button label="CSV" variant="secondary" style={{ flex: 1 }} loading={busy === 'csv'} onPress={() => doExport('csv')} />
        <Button label="Схема DXF" variant="secondary" style={{ flex: 1.3 }} loading={busy === 'dxf'} onPress={() => doExport('dxf')} />
        <Button label="За сегодня ➤" style={{ flex: 1.6 }} loading={busy === 'day'} onPress={() => doExport('day')} />
      </View>
    </View>
  );
}

function Head({ cols }: { cols: string[] }) {
  return (
    <View style={[styles.tr, styles.th]}>
      {cols.map((c, k) => <Text key={k} style={[styles.td, styles.thT, k === 0 && { flex: 1.2 }]}>{c}</Text>)}
    </View>
  );
}

function CodeChips({ codes, on, onToggle }: { codes: FeatureCode[]; on: string[]; onToggle: (c: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: 6, paddingHorizontal: space.md, paddingVertical: 6 }}>
      {codes.map((c) => {
        const sel = on.includes(c.code);
        return (
          <Pressable key={c.id} onPress={() => onToggle(c.code)}
            style={[styles.chip, { borderColor: c.color }, sel && { backgroundColor: c.color }]}>
            <Text style={[styles.chipT, sel && { color: '#0A0E14' }]}>{c.code}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  empty: { color: colors.textPrimary, fontSize: font.title, fontWeight: '800', marginBottom: space.sm },
  summary: { padding: space.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  sumT: { color: colors.textPrimary, fontSize: font.small, fontWeight: '700' },
  sumW: { color: colors.warning, fontSize: font.caption, marginTop: 2 },
  tabs: { flexDirection: 'row', padding: space.sm, gap: 6 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabT: { color: colors.textSecondary, fontSize: font.small, fontWeight: '800' },
  tabTOn: { color: colors.accentText },
  filter: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, gap: space.md },
  filterT: { flex: 1, color: colors.textSecondary, fontSize: font.small },
  hint: { color: colors.textMuted, fontSize: font.caption, padding: space.md, lineHeight: 17 },
  total: { color: colors.accent, fontSize: font.bodyLg, fontWeight: '800', paddingHorizontal: space.md, paddingBottom: space.sm },
  tr: { flexDirection: 'row', paddingHorizontal: space.md, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { backgroundColor: colors.surfaceRaised },
  td: { flex: 1, color: colors.textPrimary, fontSize: font.small, fontVariant: ['tabular-nums'] },
  thT: { color: colors.textMuted, fontWeight: '800' },
  cell: { textAlign: 'center', fontWeight: '900', fontSize: font.body },
  none: { color: colors.textMuted, fontSize: font.body, padding: space.xl, textAlign: 'center' },
  chip: { borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipT: { color: colors.textPrimary, fontSize: font.small, fontWeight: '800' },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: space.sm, padding: space.md,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
});
