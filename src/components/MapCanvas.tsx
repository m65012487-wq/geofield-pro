import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, PanResponder } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { colors, font, radius } from '../theme/theme';
import type { Basemap } from '../lib/basemap';

export interface MapPoint { id: string; name: string; north: number; east: number; color?: string }

interface Props {
  width: number;
  height: number;
  /** Текущая позиция в местных координатах. */
  here: { north: number; east: number } | null;
  points: MapPoint[];
  basemap: Basemap | null;
  /** Цель выноса — линия от позиции к ней. */
  target?: { north: number; east: number } | null;
}

const ZOOMS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]; // метров на пиксель

/** Карта в местных координатах (север вверх): подложка DXF, точки, позиция. Перетаскивание и масштаб кнопками. */
export function MapCanvas({ width, height, here, points, basemap, target }: Props) {
  const [zi, setZi] = useState(3);
  const [follow, setFollow] = useState(true);
  const [center, setCenter] = useState<{ n: number; e: number } | null>(null);
  const mpp = ZOOMS[zi];

  const c = follow && here ? { n: here.north, e: here.east }
    : center ?? (here ? { n: here.north, e: here.east }
      : basemap ? { n: (basemap.bbox[1] + basemap.bbox[3]) / 2, e: (basemap.bbox[0] + basemap.bbox[2]) / 2 } : { n: 0, e: 0 });

  const drag = useRef({ n: 0, e: 0 });
  const cRef = useRef(c); cRef.current = c;
  const mppRef = useRef(mpp); mppRef.current = mpp;
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
    onPanResponderGrant: () => { drag.current = { ...cRef.current }; setFollow(false); },
    onPanResponderMove: (_, g) => setCenter({ n: drag.current.n + g.dy * mppRef.current, e: drag.current.e - g.dx * mppRef.current }),
  }), []);

  const px = (e: number, n: number) => [width / 2 + (e - c.e) / mpp, height / 2 - (n - c.n) / mpp];

  // видимые линии подложки: грубый отбор по рамке, прореживание вершин мельче 1.5 px
  const visible = useMemo(() => {
    if (!basemap) return [];
    const hw = width / 2 * mpp, hh = height / 2 * mpp;
    const minE = c.e - hw, maxE = c.e + hw, minN = c.n - hh, maxN = c.n + hh;
    const res: Array<{ key: number; color: string; d: string }> = [];
    basemap.lines.forEach((l, idx) => {
      const lay = basemap.layers[l.layer];
      if (!lay?.visible) return;
      let inside = false;
      for (let k = 0; k < l.pts.length; k += 2) {
        if (l.pts[k] >= minE && l.pts[k] <= maxE && l.pts[k + 1] >= minN && l.pts[k + 1] <= maxN) { inside = true; break; }
      }
      if (!inside && l.pts.length === 4) {
        // отрезок может пересекать экран без вершин внутри
        const [e1, n1, e2, n2] = l.pts;
        inside = Math.max(e1, e2) >= minE && Math.min(e1, e2) <= maxE && Math.max(n1, n2) >= minN && Math.min(n1, n2) <= maxN;
      }
      if (!inside) return;
      const parts: string[] = [];
      let lx = NaN, ly = NaN;
      for (let k = 0; k < l.pts.length; k += 2) {
        const x = width / 2 + (l.pts[k] - c.e) / mpp, y = height / 2 - (l.pts[k + 1] - c.n) / mpp;
        if (k > 0 && k < l.pts.length - 2 && Math.abs(x - lx) + Math.abs(y - ly) < 1.5) continue;
        parts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        lx = x; ly = y;
      }
      res.push({ key: idx, color: lay.color, d: parts.join(' ') });
    });
    return res;
  }, [basemap, c.e, c.n, mpp, width, height]);

  const scaleBar = mpp * 80;

  return (
    <View style={[styles.wrap, { width, height }]} {...pan.panHandlers}>
      <Svg width={width} height={height}>
        {visible.map((v) => (
          <Polyline key={v.key} points={v.d} fill="none" stroke={v.color} strokeWidth={1.2} opacity={0.85} />
        ))}
        {here && target && (() => {
          const [x1, y1] = px(here.east, here.north); const [x2, y2] = px(target.east, target.north);
          return <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.accent} strokeWidth={2} strokeDasharray="6,4" />;
        })()}
        {points.map((p) => {
          const [x, y] = px(p.east, p.north);
          if (x < -20 || y < -20 || x > width + 20 || y > height + 20) return null;
          return (
            <G key={p.id}>
              <Circle cx={x} cy={y} r={4} fill={p.color ?? colors.accent} stroke={colors.bg} strokeWidth={1} />
              {mpp <= 1 && <SvgText x={x + 6} y={y + 4} fill={colors.textSecondary} fontSize={10}>{p.name}</SvgText>}
            </G>
          );
        })}
        {here && (() => {
          const [x, y] = px(here.east, here.north);
          return (
            <G>
              <Circle cx={x} cy={y} r={12} fill="none" stroke={colors.fix} strokeWidth={1.5} opacity={0.6} />
              <Circle cx={x} cy={y} r={5} fill={colors.fix} stroke={colors.bg} strokeWidth={2} />
            </G>
          );
        })()}
      </Svg>
      <Text style={styles.scale}>{scaleBar >= 1 ? `${scaleBar.toFixed(0)} м` : `${(scaleBar * 100).toFixed(0)} см`} ⟷ 80 px</Text>
      <Text style={styles.north}>С ↑</Text>
      <View style={styles.btns}>
        <Pressable style={styles.btn} onPress={() => setZi((z) => Math.max(0, z - 1))}><Text style={styles.btnT}>＋</Text></Pressable>
        <Pressable style={styles.btn} onPress={() => setZi((z) => Math.min(ZOOMS.length - 1, z + 1))}><Text style={styles.btnT}>－</Text></Pressable>
        <Pressable style={[styles.btn, follow && { borderColor: colors.fix }]} onPress={() => { setFollow(true); setCenter(null); }}>
          <Text style={[styles.btnT, follow && { color: colors.fix }]}>◎</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#05080C', borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  scale: { position: 'absolute', bottom: 6, left: 8, color: colors.textMuted, fontSize: font.caption },
  north: { position: 'absolute', top: 6, left: 8, color: colors.textSecondary, fontSize: font.small, fontWeight: '700' },
  btns: { position: 'absolute', right: 6, top: 6, gap: 6 },
  btn: {
    width: 40, height: 40, borderRadius: 8, backgroundColor: colors.surfaceRaised + 'E6',
    borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center',
  },
  btnT: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
});
