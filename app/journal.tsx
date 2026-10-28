import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Svg, { Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { ScreenHelp } from '../src/components/Help';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useCalibration, localOf } from '../src/lib/calibStore';
import { useRoad } from '../src/lib/roadCheck';
import { fmtPk, stationOf } from '../src/lib/road';
import { listPoints } from '../src/db/database';
import type { SurveyPoint } from '../src/db/types';
import { listBaseChecks, type BaseCheck } from '../src/lib/baseCheck';
import { sanitizeName, shareFile, writeCacheFile } from '../src/lib/exporter';

const p2 = (x: number) => String(x).padStart(2, '0');
const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const dayTitle = (k: string) => { const [y, m, d] = k.split('-'); return `${d}.${m}.${y}`; };
const hhmm = (ts: number) => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtDur = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${p2(m % 60)} мин`; };
const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${m.toFixed(0)} м`);

const MAP_W = 320;
const MAP_H = 220;

interface Summary {
  count: number;
  byCode: Array<[string, number]>;
  first: number; last: number;
  route: number;
  pk: [number, number] | null;
  xy: Array<[number, number]>;
}

/** Журнал дня: что сделано за выбранный день съёмки — точки, коды, время, маршрут, пикеты, проверки на репере. */
export default function JournalScreen() {
  const { project } = useActiveProject();
  const calib = useCalibration(project?.id);
  const road = useRoad(project?.id);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [checks, setChecks] = useState<BaseCheck[]>([]);
  const [day, setDay] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    if (!project) return;
    listPoints(project.id).then(setPoints);
    listBaseChecks(project.id).then(setChecks);
  }, [project?.id]));

  const days = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of points) { const k = dayKey(p.createdAt); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [points]);

  const cur = day ?? days[0]?.[0] ?? null;

  const sum = useMemo<Summary | null>(() => {
    if (!cur) return null;
    const pts = points.filter((p) => dayKey(p.createdAt) === cur).sort((a, b) => a.createdAt - b.createdAt);
    if (!pts.length) return null;
    const codes = new Map<string, number>();
    const xy: Array<[number, number]> = [];
    let route = 0;
    let lo = Infinity; let hi = -Infinity;
    for (const p of pts) {
      const c = p.code || '—';
      codes.set(c, (codes.get(c) ?? 0) + 1);
      const loc = p.north != null && p.east != null ? { north: p.north, east: p.east } : localOf(calib, p.latitude, p.longitude, p.elevation);
      if (!loc) continue;
      if (xy.length) route += Math.hypot(loc.north - xy[xy.length - 1][0], loc.east - xy[xy.length - 1][1]);
      xy.push([loc.north, loc.east]);
      if (road) {
        const st = stationOf(road, loc.north, loc.east);
        if (!st.outside) { lo = Math.min(lo, st.s); hi = Math.max(hi, st.s); }
      }
    }
    return {
      count: pts.length,
      byCode: [...codes.entries()].sort((a, b) => b[1] - a[1]),
      first: pts[0].createdAt, last: pts[pts.length - 1].createdAt,
      route, pk: lo <= hi ? [lo, hi] : null, xy,
    };
  }, [cur, points, calib, road]);

  const dayChecks = useMemo(() => (cur ? checks.filter((c) => dayKey(c.ts) === cur) : []), [checks, cur]);

  const text = () => {
    if (!sum || !cur || !project) return '';
    const L = [
      `Журнал дня ${dayTitle(cur)} — ${project.name}`,
      `Точек: ${sum.count}`,
      `По кодам: ${sum.byCode.map(([c, n]) => `${c} ${n}`).join(', ')}`,
      `Время: ${hhmm(sum.first)} – ${hhmm(sum.last)} (${fmtDur(sum.last - sum.first)})`,
    ];
    if (sum.pk) L.push(`Пикеты: ПК ${fmtPk(sum.pk[0])} – ПК ${fmtPk(sum.pk[1])}`);
    if (sum.xy.length > 1) L.push(`Пройдено по маршруту: ${fmtDist(sum.route)}`);
    L.push(dayChecks.length ? 'Контроль на репере:' : 'Контроль на репере: не проводился');
    for (const c of dayChecks) {
      L.push(`  ${hhmm(c.ts)} ${c.name}: ${c.ok ? 'в допуске' : 'РАСХОЖДЕНИЕ'}, план ${(Math.hypot(c.dN, c.dE) * 1000).toFixed(0)} мм, ΔH ${(c.dH * 1000).toFixed(0)} мм`);
    }
    return L.join('\n');
  };

  const share = async () => {
    try {
      const f = writeCacheFile(`${sanitizeName(project!.name)}_журнал_${cur}.txt`, text());
      await shareFile(f, 'text/plain', 'Сводка дня');
    } catch (e: any) { Alert.alert('Не удалось поделиться', String(e?.message ?? e)); }
  };

  if (!project) {
    return <View style={[shared.container, styles.center]}><Text style={shared.muted}>Сначала выберите проект.</Text></View>;
  }

  return (
    <ScrollView style={shared.container} contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }}>
      <ScreenHelp title="Журнал дня"
        text={'Что делает: собирает сводку за один день съёмки — сколько точек, каких кодов, когда начали и закончили, какие пикеты прошли, сколько прошли по маршруту и были ли проверки на репере.\n\n'
          + 'Как пользоваться:\n1. Вверху выберите день (по умолчанию — последний).\n2. Посмотрите сводку и схему маршрута: зелёная точка — начало, красная — конец.\n3. «Поделиться сводкой» отправит текстовый файл — например в мессенджер.\n\n'
          + 'Особенности: день определяется по дате записи точки на телефоне. Маршрут и пикеты считаются по местным координатам — нужна калибровка проекта, пикеты ещё и загруженная трасса. Длина маршрута — сумма расстояний между точками по порядку съёмки, а не реальный путь.'} />

      {days.length === 0 ? (
        <Text style={[shared.muted, { textAlign: 'center', marginTop: space.xl }]}>В проекте ещё нет снятых точек.</Text>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
            {days.map(([k, n]) => (
              <Pressable key={k} onPress={() => setDay(k)} style={[styles.chip, k === cur && styles.chipOn]}>
                <Text style={[styles.chipT, k === cur && { color: colors.accentText }]}>{dayTitle(k)} · {n}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {sum && (
            <>
              <Card>
                <Text style={styles.big}>{sum.count} <Text style={styles.unit}>точек</Text></Text>
                <Text style={styles.line}>{sum.byCode.map(([c, n]) => `${c} ${n}`).join(' · ')}</Text>
                <Text style={styles.line}>Время: {hhmm(sum.first)} – {hhmm(sum.last)} · {fmtDur(sum.last - sum.first)}</Text>
                {sum.pk && <Text style={styles.line}>Пикеты: ПК {fmtPk(sum.pk[0])} – ПК {fmtPk(sum.pk[1])}</Text>}
                {sum.xy.length > 1
                  ? <Text style={styles.line}>Пройдено по маршруту: {fmtDist(sum.route)}</Text>
                  : <Text style={shared.muted}>Маршрут недоступен — нет калибровки или одна точка.</Text>}
              </Card>

              {sum.xy.length > 1 && (
                <Card style={{ marginTop: space.lg }}>
                  <Text style={shared.sectionTitle}>Маршрут</Text>
                  <RouteMap xy={sum.xy} />
                </Card>
              )}

              <Card style={{ marginTop: space.lg }}>
                <Text style={shared.sectionTitle}>Контроль на репере</Text>
                {dayChecks.length === 0 && <Text style={[shared.muted, { color: colors.warning }]}>В этот день не проводился.</Text>}
                {dayChecks.map((c, i) => (
                  <Text key={i} style={[styles.line, { color: c.ok ? colors.fix : colors.danger }]}>
                    {hhmm(c.ts)} {c.name}: {c.ok ? 'в допуске' : 'РАСХОЖДЕНИЕ'} · план {(Math.hypot(c.dN, c.dE) * 1000).toFixed(0)} мм · ΔH {(c.dH * 1000).toFixed(0)} мм
                  </Text>
                ))}
              </Card>

              <Button label="Поделиться сводкой" onPress={share} style={{ marginTop: space.lg }} />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

/** Схема маршрута: север вверх, масштаб по большей стороне, начало зелёное, конец красный. */
function RouteMap({ xy }: { xy: Array<[number, number]> }) {
  const pad = 18;
  const ns = xy.map((p) => p[0]); const es = xy.map((p) => p[1]);
  const n0 = Math.min(...ns); const n1 = Math.max(...ns); const e0 = Math.min(...es); const e1 = Math.max(...es);
  const k = Math.min((MAP_W - 2 * pad) / Math.max(e1 - e0, 1e-6), (MAP_H - 2 * pad) / Math.max(n1 - n0, 1e-6));
  const ox = (MAP_W - (e1 - e0) * k) / 2; const oy = (MAP_H - (n1 - n0) * k) / 2;
  const pt = (p: [number, number]) => [ox + (p[1] - e0) * k, MAP_H - oy - (p[0] - n0) * k] as const;
  const pts = xy.map((p) => pt(p).join(',')).join(' ');
  const a = pt(xy[0]); const b = pt(xy[xy.length - 1]);
  return (
    <Svg width="100%" height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
      <Polyline points={pts} fill="none" stroke={colors.accent} strokeWidth={2} />
      {xy.map((p, i) => <Circle key={i} cx={pt(p)[0]} cy={pt(p)[1]} r={2} fill={colors.accentDim} />)}
      <Circle cx={a[0]} cy={a[1]} r={7} fill={colors.fix} />
      <SvgText x={a[0] + 10} y={a[1] - 8} fill={colors.textPrimary} fontSize={11}>начало</SvgText>
      <Circle cx={b[0]} cy={b[1]} r={7} fill={colors.danger} />
      <SvgText x={b[0] + 10} y={b[1] - 8} fill={colors.textPrimary} fontSize={11}>конец</SvgText>
    </Svg>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  chip: {
    paddingHorizontal: space.lg, minHeight: 44, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.borderStrong, justifyContent: 'center', backgroundColor: colors.surfaceRaised,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipT: { color: colors.textPrimary, fontSize: font.body, fontWeight: '700' },
  big: { color: colors.accent, fontSize: font.display, fontWeight: '800' },
  unit: { color: colors.textSecondary, fontSize: font.bodyLg, fontWeight: '500' },
  line: { color: colors.textPrimary, fontSize: font.body, marginTop: space.xs, lineHeight: 21 },
});
