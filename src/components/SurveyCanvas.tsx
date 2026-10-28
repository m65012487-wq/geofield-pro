import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Circle, Text as SvgText, G, Polyline, Polygon } from 'react-native-svg';
import { colors, font } from '../theme/theme';
import { toLocalMeters } from '../lib/geo';
import type { SurveyPoint, LivePosition, Feature } from '../db/types';

interface Props {
  position: LivePosition | null;
  points: SurveyPoint[];
  features?: Feature[];
  /** Вершины линии, снимаемой прямо сейчас. */
  draft?: { lat: number; lon: number }[];
  width: number;
  height: number;
}

/** Полевой холст: позиция, точки, линии и полигоны в локальных метрах. Север сверху. */
export function SurveyCanvas({ position, points, features = [], draft = [], width, height }: Props) {
  const cx = width / 2;
  const cy = height / 2;

  const { localPoints, localFeatures, localDraft, scale } = useMemo(() => {
    if (!position) return { localPoints: [], localFeatures: [], localDraft: [], scale: 1 };
    const ref = { lat: position.latitude, lon: position.longitude };
    const toL = (lat: number, lon: number) => toLocalMeters(ref.lat, ref.lon, lat, lon);

    const lp = points.map((p) => ({ ...p, ...toL(p.latitude, p.longitude) }));
    const lf = features.map((f) => ({
      id: f.id, type: f.type, name: f.name,
      pts: f.vertices.map((v) => toL(v.lat, v.lon)),
    }));
    const ld = draft.map((v) => toL(v.lat, v.lon));

    let maxR = 10;
    for (const l of lp) maxR = Math.max(maxR, Math.abs(l.x), Math.abs(l.y));
    for (const f of lf) for (const p of f.pts) maxR = Math.max(maxR, Math.abs(p.x), Math.abs(p.y));
    for (const p of ld) maxR = Math.max(maxR, Math.abs(p.x), Math.abs(p.y));
    maxR *= 1.25;
    const pxPerMeter = Math.min(width, height) / 2 / maxR;
    return { localPoints: lp, localFeatures: lf, localDraft: ld, scale: pxPerMeter };
  }, [position, points, features, draft, width, height]);

  const gridStepM = useMemo(() => {
    const target = 40 / scale;
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(target, 1e-9))));
    const norm = target / pow;
    const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
    return step * pow;
  }, [scale]);

  const gridLines: number[] = [];
  if (position) {
    const stepPx = gridStepM * scale;
    for (let i = 1; i * stepPx < Math.max(width, height); i++) gridLines.push(i * stepPx);
  }

  const toPx = (p: { x: number; y: number }) => `${cx + p.x * scale},${cy - p.y * scale}`;

  return (
    <View style={[styles.wrap, { width, height }]}>
      <Svg width={width} height={height}>
        {gridLines.map((off, i) => (
          <G key={'g' + i}>
            <Line x1={cx + off} y1={0} x2={cx + off} y2={height} stroke={colors.border} strokeWidth={0.5} />
            <Line x1={cx - off} y1={0} x2={cx - off} y2={height} stroke={colors.border} strokeWidth={0.5} />
            <Line x1={0} y1={cy + off} x2={width} y2={cy + off} stroke={colors.border} strokeWidth={0.5} />
            <Line x1={0} y1={cy - off} x2={width} y2={cy - off} stroke={colors.border} strokeWidth={0.5} />
          </G>
        ))}
        <Line x1={cx} y1={0} x2={cx} y2={height} stroke={colors.borderStrong} strokeWidth={1} />
        <Line x1={0} y1={cy} x2={width} y2={cy} stroke={colors.borderStrong} strokeWidth={1} />

        {/* Линии и полигоны */}
        {localFeatures.map((f) =>
          f.type === 'polygon' ? (
            <Polygon key={f.id} points={f.pts.map(toPx).join(' ')}
              fill={colors.accent} fillOpacity={0.12} stroke={colors.accentDim} strokeWidth={2} />
          ) : (
            <Polyline key={f.id} points={f.pts.map(toPx).join(' ')}
              fill="none" stroke={colors.float} strokeWidth={2} />
          )
        )}

        {/* Черновик — линия в процессе съёмки */}
        {localDraft.length > 0 && (
          <Polyline points={localDraft.map(toPx).join(' ')}
            fill="none" stroke={colors.fix} strokeWidth={2} strokeDasharray="6,4" />
        )}
        {localDraft.map((p, i) => (
          <Circle key={'d' + i} cx={cx + p.x * scale} cy={cy - p.y * scale} r={4} fill={colors.fix} />
        ))}

        {/* Точки */}
        {localPoints.map((l) => {
          const px = cx + l.x * scale;
          const py = cy - l.y * scale;
          return (
            <G key={l.id}>
              <Circle cx={px} cy={py} r={6} fill={colors.accent} stroke={colors.bg} strokeWidth={1.5} />
              <SvgText x={px + 9} y={py + 4} fill={colors.textSecondary} fontSize={font.caption}>{l.name}</SvgText>
            </G>
          );
        })}

        {/* Текущая позиция */}
        {position && (
          <G>
            <Circle cx={cx} cy={cy} r={14} fill="none" stroke={colors.fix} strokeWidth={1.5} opacity={0.5} />
            <Circle cx={cx} cy={cy} r={6} fill={colors.fix} stroke={colors.bg} strokeWidth={2} />
          </G>
        )}
      </Svg>
      <Text style={styles.scaleLabel}>{position ? `Сетка: ${gridStepM} м` : 'Ожидание GPS…'}</Text>
      <Text style={styles.northLabel}>С ↑</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bg, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  scaleLabel: { position: 'absolute', bottom: 8, left: 10, color: colors.textMuted, fontSize: font.caption },
  northLabel: { position: 'absolute', top: 8, right: 10, color: colors.textSecondary, fontSize: font.small, fontWeight: '700' },
});
