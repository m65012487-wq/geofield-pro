import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Card, QualityBadge } from '../src/components/ui';
import { useGnss } from '../src/lib/useGnss';
import { haversine, bearing, toLocalMeters } from '../src/lib/geo';
import { getPoint } from '../src/db/database';
import type { SurveyPoint } from '../src/db/types';

const ARROW_SIZE = 220;
/** Дистанция «в допуске» — сигнал попадания, м. */
const HIT_TOLERANCE = 0.5;

/** Вынос точки: стрелка на цель (с учётом компаса), расстояние, дельты С/В/H. */
export default function StakeoutScreen() {
  const { pointId } = useLocalSearchParams<{ pointId: string }>();
  const { position } = useGnss();
  const [target, setTarget] = useState<SurveyPoint | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const hitRef = useRef(false);

  useEffect(() => {
    if (pointId) getPoint(pointId).then(setTarget);
  }, [pointId]);

  // Компас
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    Location.watchHeadingAsync((h) => {
      const val = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      setHeading(val);
    }).then((s) => { sub = s; }).catch(() => {});
    return () => { sub?.remove(); };
  }, []);

  const nav = useMemo(() => {
    if (!position || !target) return null;
    const dist = haversine(position.latitude, position.longitude, target.latitude, target.longitude);
    const az = bearing(position.latitude, position.longitude, target.latitude, target.longitude);
    const local = toLocalMeters(position.latitude, position.longitude, target.latitude, target.longitude);
    const dH = target.elevation - position.elevation;
    return { dist, az, dN: local.y, dE: local.x, dH };
  }, [position, target]);

  // Вибрация при попадании в допуск
  useEffect(() => {
    if (!nav) return;
    const hit = nav.dist <= HIT_TOLERANCE;
    if (hit && !hitRef.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    hitRef.current = hit;
  }, [nav?.dist]);

  const arrowRotation = nav != null && heading != null ? nav.az - heading : nav?.az ?? 0;
  const inTolerance = (nav?.dist ?? Infinity) <= HIT_TOLERANCE;

  return (
    <ScrollView style={shared.container} contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }}>
      <Stack.Screen options={{ title: target ? `Вынос: ${target.name}` : 'Вынос точки' }} />

      <Card style={styles.headerCard}>
        <View style={shared.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.targetName}>{target?.name ?? '…'}</Text>
            {!!target?.code && <Text style={styles.targetCode}>{target.code}</Text>}
          </View>
          <QualityBadge quality={position?.quality ?? 'none'} />
        </View>
      </Card>

      {/* Стрелка направления */}
      <View style={styles.arrowWrap}>
        <Svg width={ARROW_SIZE} height={ARROW_SIZE} viewBox="0 0 100 100">
          <Circle cx={50} cy={50} r={48} fill={colors.surface}
            stroke={inTolerance ? colors.fix : colors.border} strokeWidth={inTolerance ? 2.5 : 1} />
          {inTolerance ? (
            <Circle cx={50} cy={50} r={14} fill={colors.fix} />
          ) : (
            <Polygon
              points="50,12 66,62 50,50 34,62"
              fill={colors.accent}
              transform={`rotate(${arrowRotation} 50 50)`}
            />
          )}
        </Svg>
        <Text style={[styles.distText, inTolerance && { color: colors.fix }]}>
          {nav ? (nav.dist < 100 ? nav.dist.toFixed(2) : nav.dist.toFixed(1)) : '—'}
          <Text style={styles.distUnit}> м</Text>
        </Text>
        <Text style={styles.arrowHint}>
          {inTolerance
            ? 'ВЫ НА ТОЧКЕ'
            : heading != null
              ? 'Стрелка учитывает компас — идите по ней'
              : `Азимут на точку: ${nav ? nav.az.toFixed(1) : '—'}°`}
        </Text>
      </View>

      {/* Дельты */}
      <View style={styles.deltaGrid}>
        <Delta label="Δ Север" value={nav?.dN} />
        <Delta label="Δ Восток" value={nav?.dE} />
        <Delta label="Δ Высота" value={nav?.dH} />
      </View>

      {!position && (
        <Text style={[shared.muted, { textAlign: 'center', marginTop: space.lg }]}>
          Ожидание GPS…
        </Text>
      )}
    </ScrollView>
  );
}

function Delta({ label, value }: { label: string; value: number | undefined }) {
  const v = value ?? 0;
  const has = value !== undefined;
  return (
    <View style={styles.deltaCell}>
      <Text style={styles.deltaLabel}>{label}</Text>
      <Text style={[styles.deltaValue, has && Math.abs(v) <= 0.5 && { color: colors.fix }]}>
        {has ? (v >= 0 ? '+' : '') + v.toFixed(2) : '—'}
      </Text>
      <Text style={styles.deltaUnit}>м</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerCard: { marginBottom: space.lg },
  targetName: { color: colors.textPrimary, fontSize: font.title, fontWeight: '800' },
  targetCode: { color: colors.accent, fontSize: font.small, fontWeight: '600', marginTop: 2 },
  arrowWrap: { alignItems: 'center', marginVertical: space.lg },
  distText: {
    color: colors.textPrimary, fontSize: 52, fontWeight: '800',
    marginTop: space.md, fontVariant: ['tabular-nums'],
  },
  distUnit: { fontSize: font.title, color: colors.textMuted, fontWeight: '600' },
  arrowHint: { color: colors.textMuted, fontSize: font.small, marginTop: 4, textAlign: 'center' },
  deltaGrid: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  deltaCell: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', paddingVertical: space.lg,
  },
  deltaLabel: { color: colors.textMuted, fontSize: font.caption },
  deltaValue: {
    color: colors.textPrimary, fontSize: font.title, fontWeight: '700',
    marginTop: 6, fontVariant: ['tabular-nums'],
  },
  deltaUnit: { color: colors.textMuted, fontSize: font.caption, marginTop: 2 },
});
