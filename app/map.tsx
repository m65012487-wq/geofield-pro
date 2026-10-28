import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, Switch, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, QualityBadge } from '../src/components/ui';
import { FloatingShutter } from '../src/components/FloatingShutter';
import { useShutter } from '../src/lib/useShutter';
import { MapCanvas, type MapKnown, type MapPoint } from '../src/components/MapCanvas';
import { useGnss } from '../src/lib/useGnss';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useShot } from '../src/lib/useShot';
import { ShotModes } from '../src/components/ShotModes';
import { useCalibration, localOf } from '../src/lib/calibStore';
import { loadBasemap, saveBasemap, type Basemap } from '../src/lib/basemap';
import {
  listPoints, listCodes, listKnown, kvGet, kvSet, nextNamesForCodes,
} from '../src/db/database';
import type { FeatureCode, KnownPoint, SurveyPoint } from '../src/db/types';

/**
 * Карта во весь экран, как в LandStar / ApeSurvey: подложка, точки, реперы, своя позиция;
 * сверху — код объекта и имя следующей точки, снизу — N/E/H и кнопка «Измерить».
 */
export default function MapScreen() {
  const router = useRouter();
  const { project } = useActiveProject();
  const gnss = useGnss();
  const { position } = gnss;
  const calib = useCalibration(project?.id);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [codes, setCodes] = useState<FeatureCode[]>([]);
  const [known, setKnown] = useState<KnownPoint[]>([]);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [nextNames, setNextNames] = useState<Record<string, string>>({});
  const [antH, setAntH] = useState(2);
  const [tiltByReceiver, setTiltByReceiver] = useState(false);
  const [layers, setLayers] = useState({ labels: true, known: true, points: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const [info, setInfo] = useState<{ title: string; lines: string[] } | null>(null);
  const [floatOn, setFloatOn] = useState(true);
  const pole = tiltByReceiver ? 0 : antH;

  const load = useCallback(() => {
    if (!project) return;
    listPoints(project.id).then(setPoints);
    listKnown(project.id).then(setKnown);
    loadBasemap(project.id).then(setBasemap);
    listCodes().then((cs) => {
      setCodes(cs);
      nextNamesForCodes(project.id, cs.map((c) => c.code)).then(setNextNames);
    });
    kvGet('antennaHeight').then((v) => v && setAntH(parseFloat(v)));
    kvGet('tiltByReceiver').then((v) => setTiltByReceiver(v === '1'));
    kvGet('floatShutter').then((v) => setFloatOn(v !== '0'));
    kvGet('mapLayers').then((v) => { if (v) try { setLayers(JSON.parse(v)); } catch { /* по умолчанию */ } });
  }, [project?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const live = position && position.quality !== 'none'
    ? localOf(calib, position.latitude, position.longitude, position.elevation - pole) : null;

  const mapPoints = useMemo<MapPoint[]>(() => points.flatMap((p) => {
    const l = p.north != null && p.east != null
      ? { north: p.north, east: p.east, height: p.height } : localOf(calib, p.latitude, p.longitude, p.elevation);
    const color = codes.find((c) => c.code === p.code)?.color;
    return l ? [{ id: p.id, name: p.name, code: p.code, north: l.north, east: l.east, height: l.height, color }] : [];
  }), [points, calib, codes]);

  const last = mapPoints[0];
  const dLast = live && last ? Math.hypot(live.north - last.north, live.east - last.east) : null;

  const shot = useShot(position, { projectId: project?.id, calib, pole, codes, onSaved: load });
  const code = shot.cur && codes.some((c) => c.code === shot.cur) ? shot.cur : null;

  useShutter(shot.trigger);

  const pickCode = (c: string) => shot.setCur(c);

  const setLayer = (k: keyof typeof layers, v: boolean) => {
    const next = { ...layers, [k]: v };
    setLayers(next);
    kvSet('mapLayers', JSON.stringify(next));
  };
  const toggleBaseLayer = (i: number) => {
    if (!project || !basemap) return;
    const next = { ...basemap, layers: basemap.layers.map((l, k) => (k === i ? { ...l, visible: !l.visible } : l)) };
    saveBasemap(project.id, next);
    setBasemap(next);
  };

  const showInfo = (p: MapPoint | MapKnown, kind: 'point' | 'known') => {
    const lines = [`N ${p.north.toFixed(3)}`, `E ${p.east.toFixed(3)}`];
    if (p.height != null) lines.push(`H ${p.height.toFixed(3)}`);
    if (kind === 'point' && 'code' in p && p.code) lines.push(`Код ${p.code}`);
    if (live) lines.push(`До меня ${Math.hypot(live.north - p.north, live.east - p.east).toFixed(2)} м`);
    setInfo({ title: kind === 'known' ? `Репер ${p.name}` : p.name, lines });
  };

  if (!project) {
    return (
      <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={shared.muted}>Сначала выберите проект.</Text>
      </View>
    );
  }

  const cur = codes.find((c) => c.code === code);
  const noLocal = !calib?.cal;
  return (
    <View style={shared.container}>
      {/* статус приёмника */}
      <Pressable style={styles.status} onPress={() => router.push('/receiver')}>
        <QualityBadge quality={position?.quality ?? 'none'} />
        <Text style={styles.statusT} numberOfLines={1}>
          {position && position.quality !== 'none'
            ? `${position.satellites ?? '–'} сп. · σ ${fmt(position.hAccuracy)}/${fmt(position.vAccuracy)}`
              + (position.diffAge != null && position.diffAge >= 0 ? ` · ${position.diffAge.toFixed(0)} с` : '')
            : gnss.message || 'Нет данных'}
        </Text>
        <Text style={styles.pole}>{tiltByReceiver ? '⟂ IMU' : `⟂ ${antH.toFixed(2)}`}</Text>
      </Pressable>

      {/* объект и имя следующей точки */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.codesBar}
        contentContainerStyle={{ paddingHorizontal: space.sm, gap: 6, alignItems: 'center' }}>
        {codes.map((c) => {
          const on = c.code === code;
          return (
            <Pressable key={c.id} onPress={() => pickCode(c.code)}
              style={[styles.chip, { borderColor: c.color }, on && { backgroundColor: c.color }]}>
              <Text style={[styles.chipT, on && { color: '#0A0E14' }]} numberOfLines={1}>
                {c.description || c.code} · {nextNames[c.code] ?? c.code}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ShotModes shot={shot} />

      <View style={{ flex: 1, padding: 6 }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width - 12, h: e.nativeEvent.layout.height - 12 })}>
        {size.w > 0 && (
          <MapCanvas width={size.w} height={size.h} basemap={basemap}
            here={live ? { north: live.north, east: live.east } : null}
            points={layers.points ? mapPoints : []}
            known={known} showKnown={layers.known} showLabels={layers.labels}
            onTapPoint={showInfo} />
        )}
        <Pressable style={styles.layersBtn} onPress={() => setLayersOpen(true)}>
          <Text style={styles.layersT}>Слои</Text>
        </Pressable>
        {noLocal && (
          <Text style={styles.warn} pointerEvents="none">
            Нет калибровки — своя позиция и точки на план не лягут. Работа → Калибровка.
          </Text>
        )}
      </View>

      {/* координаты и измерение */}
      <View style={styles.bottom}>
        <View style={styles.coords}>
          <Cell l="N" v={live ? live.north.toFixed(3) : '—'} />
          <Cell l="E" v={live ? live.east.toFixed(3) : '—'} />
          <Cell l="H" v={live ? live.height.toFixed(3) : '—'} />
          <Cell l="до посл." v={dLast != null ? `${dLast.toFixed(2)} м` : '—'} />
        </View>
        <Pressable onPress={shot.trigger}
          style={({ pressed }) => [styles.measure, { backgroundColor: shot.running ? colors.dangerBg : cur?.color ?? colors.accent, opacity: pressed ? 0.85 : 1 }]}>
          <Text style={[styles.measureT, shot.running && { color: colors.danger }]}>
            {shot.running ? shot.waitingFix ? `Жду FIX — отмена` : `Измерение ${shot.count}/${shot.need} — отмена` : `◉ Измерить  ${code ? nextNames[code] ?? code : ''}`}
          </Text>
        </Pressable>
      </View>

      {floatOn && (
        <FloatingShutter color={cur?.color ?? colors.accent} running={shot.running} onPress={shot.trigger}
          label={shot.waitingFix ? "FIX…" : shot.running ? `${shot.count}/${shot.need}` : code ? nextNames[code] ?? code : '—'} />
      )}

      {/* слои */}
      <Modal visible={layersOpen} transparent animationType="slide" onRequestClose={() => setLayersOpen(false)}>
        <View style={shared.modalOverlay}>
          <View style={[shared.modalSheet, { maxHeight: '75%' }]}>
            <Text style={shared.modalTitle}>Слои карты</Text>
            <ScrollView>
              <LayerRow label="Снятые точки" value={layers.points} onChange={(v) => setLayer('points', v)} />
              <LayerRow label={`Реперы (${known.length})`} value={layers.known} onChange={(v) => setLayer('known', v)} />
              <LayerRow label="Подписи" value={layers.labels} onChange={(v) => setLayer('labels', v)} />
              {basemap && <Text style={[shared.label, { marginTop: space.md }]}>Подложка: {basemap.name}</Text>}
              {basemap?.layers.map((l, i) => (
                <LayerRow key={l.name} label={l.name} color={l.color} value={l.visible} onChange={() => toggleBaseLayer(i)} />
              ))}
            </ScrollView>
            <Button label="Готово" onPress={() => setLayersOpen(false)} style={{ marginTop: space.md }} />
          </View>
        </View>
      </Modal>

      {/* сведения о точке */}
      <Modal visible={info != null} transparent animationType="fade" onRequestClose={() => setInfo(null)}>
        <Pressable style={shared.modalOverlay} onPress={() => setInfo(null)}>
          <View style={shared.modalSheet}>
            <Text style={shared.modalTitle}>{info?.title}</Text>
            {info?.lines.map((t) => <Text key={t} style={styles.infoLine}>{t}</Text>)}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Cell({ l, v }: { l: string; v: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellL}>{l}</Text>
      <Text style={styles.cellV} numberOfLines={1}>{v}</Text>
    </View>
  );
}

function LayerRow({ label, value, onChange, color }: { label: string; value: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <View style={styles.layerRow}>
      {color && <View style={[styles.sw, { backgroundColor: color }]} />}
      <Text style={styles.layerL} numberOfLines={1}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function fmt(v: number | undefined | null) {
  if (v == null || !Number.isFinite(v)) return '–';
  return v < 1 ? v.toFixed(3) : v.toFixed(1);
}

const styles = StyleSheet.create({
  status: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: 6,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  statusT: { flex: 1, color: colors.textPrimary, fontSize: font.small, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pole: { color: colors.textSecondary, fontSize: font.small, fontWeight: '700' },
  codesBar: { flexGrow: 0, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  chip: { borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  chipT: { color: colors.textPrimary, fontSize: font.small, fontWeight: '800' },
  layersBtn: {
    position: 'absolute', left: 14, top: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: colors.surfaceRaised + 'E6', borderWidth: 1, borderColor: colors.borderStrong,
  },
  layersT: { color: colors.textPrimary, fontSize: font.small, fontWeight: '800' },
  warn: {
    position: 'absolute', left: 14, right: 70, bottom: 44, color: colors.warning, fontSize: font.caption,
    backgroundColor: '#000000AA', padding: 6, borderRadius: 6,
  },
  bottom: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, padding: space.sm, gap: space.sm },
  coords: { flexDirection: 'row' },
  cell: { flex: 1 },
  cellL: { color: colors.textMuted, fontSize: font.caption },
  cellV: { color: colors.textPrimary, fontSize: font.body, fontWeight: '800', fontVariant: ['tabular-nums'] },
  measure: { minHeight: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  measureT: { color: '#0A0E14', fontSize: font.bodyLg, fontWeight: '900' },
  layerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  sw: { width: 14, height: 14, borderRadius: 3 },
  layerL: { flex: 1, color: colors.textPrimary, fontSize: font.body },
  infoLine: { color: colors.textPrimary, fontSize: font.bodyLg, fontVariant: ['tabular-nums'], marginTop: 4 },
});
