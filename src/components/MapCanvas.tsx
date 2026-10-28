import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, PanResponder, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';
import { colors, font, radius } from '../theme/theme';
import type { Basemap } from '../lib/basemap';

export interface MapPoint { id: string; name: string; north: number; east: number; height?: number | null; code?: string; color?: string }
export interface MapKnown { id: string; name: string; north: number; east: number; height: number }

interface Props {
  width: number;
  height: number;
  /** Текущая позиция в местных координатах. */
  here: { north: number; east: number } | null;
  points: MapPoint[];
  basemap: Basemap | null;
  known?: MapKnown[];
  showLabels?: boolean;
  showKnown?: boolean;
  /** Цель выноса — линия от позиции к ней. */
  target?: { north: number; east: number } | null;
  /** Нажатие по точке или реперу на карте. */
  onTapPoint?: (p: MapPoint | MapKnown, kind: 'point' | 'known') => void;
  /** Мельче кнопки — для карты, встроенной в экран съёмки. */
  compact?: boolean;
  /** Линии по коду: pts — E0,N0,E1,N1,… в местных координатах. */
  lines?: Array<{ color: string; pts: number[] }>;
}

const MIN_MPP = 0.01;
const MAX_MPP = 200;
const clampMpp = (v: number) => Math.min(MAX_MPP, Math.max(MIN_MPP, v));

/**
 * Карта в местных координатах (север вверх), как в LandStar/ApeSurvey: подложка DXF, снятые точки,
 * реперы, позиция. Один палец — сдвиг, два — масштаб, касание точки — сведения о ней.
 */
export function MapCanvas({
  width, height, here, points, basemap, known = [], showLabels = true, showKnown = true, target, onTapPoint, compact, lines,
}: Props) {
  const fitAll = () => {
    const xs: number[] = [], ys: number[] = [];
    if (basemap) { xs.push(basemap.bbox[0], basemap.bbox[2]); ys.push(basemap.bbox[1], basemap.bbox[3]); }
    for (const p of points) { xs.push(p.east); ys.push(p.north); }
    if (here) { xs.push(here.east); ys.push(here.north); }
    if (!xs.length) return { n: 0, e: 0, mpp: 0.5 };
    const minE = Math.min(...xs), maxE = Math.max(...xs), minN = Math.min(...ys), maxN = Math.max(...ys);
    const mpp = clampMpp(Math.max((maxE - minE) / width, (maxN - minN) / height, 0.02) * 1.15);
    return { n: (minN + maxN) / 2, e: (minE + maxE) / 2, mpp };
  };

  const [view, setView] = useState(() => (here ? { n: here.north, e: here.east, mpp: 0.5 } : fitAll()));
  const [follow, setFollow] = useState(here != null);
  // подложка и позиция приходят асинхронно: пока карту не трогали — подстраиваемся под них
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    if (here) { setFollow(true); return; }
    setView(fitAll());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, here != null, width, height]);

  const c = follow && here ? { n: here.north, e: here.east, mpp: view.mpp } : view;
  const mpp = c.mpp;

  // жесты: refs, чтобы PanResponder (создан один раз) видел свежие значения
  const cRef = useRef(c); cRef.current = c;
  const sizeRef = useRef({ width, height }); sizeRef.current = { width, height };
  const tapRef = useRef(onTapPoint); tapRef.current = onTapPoint;
  const hitRef = useRef<(x: number, y: number) => void>(() => {});
  const start = useRef({ n: 0, e: 0, mpp: 1, dist: 0, moved: false, x: 0, y: 0 });

  const pan = useMemo(() => {
    const dist = (e: GestureResponderEvent) => {
      const t = e.nativeEvent.touches;
      return t.length >= 2 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        touched.current = true;
        start.current = {
          ...cRef.current, dist: dist(e), moved: false,
          x: e.nativeEvent.locationX, y: e.nativeEvent.locationY,
        };
      },
      onPanResponderMove: (e, g) => {
        const s = start.current;
        const d = dist(e);
        if (d > 0) {
          if (s.dist === 0) { s.dist = d; s.mpp = cRef.current.mpp; s.n = cRef.current.n; s.e = cRef.current.e; return; }
          s.moved = true;
          setView({ n: s.n, e: s.e, mpp: clampMpp(s.mpp * s.dist / d) });
          if (!Number.isNaN(s.n)) setFollow(false);
          return;
        }
        if (Math.abs(g.dx) + Math.abs(g.dy) < 6 && !s.moved) return;
        s.moved = true;
        setFollow(false);
        setView({ n: s.n + g.dy * s.mpp, e: s.e - g.dx * s.mpp, mpp: s.mpp });
      },
      onPanResponderRelease: () => {
        const s = start.current;
        if (!s.moved) hitRef.current(s.x, s.y);
      },
    });
  }, []);

  const toPx = (e: number, n: number): [number, number] => [width / 2 + (e - c.e) / mpp, height / 2 - (n - c.n) / mpp];

  hitRef.current = (x, y) => {
    if (!tapRef.current) return;
    let best: { d: number; p: MapPoint | MapKnown; kind: 'point' | 'known' } | null = null;
    for (const p of points) {
      const [px, py] = toPx(p.east, p.north);
      const d = Math.hypot(px - x, py - y);
      if (d < 24 && (!best || d < best.d)) best = { d, p, kind: 'point' };
    }
    if (showKnown && mpp <= 5) for (const k of known) {
      const [px, py] = toPx(k.east, k.north);
      const d = Math.hypot(px - x, py - y);
      if (d < 24 && (!best || d < best.d)) best = { d, p: k, kind: 'known' };
    }
    if (best) tapRef.current(best.p, best.kind);
  };

  // видимые линии подложки: отбор по рамке, прореживание вершин мельче 1.5 px
  const visible = useMemo(() => {
    if (!basemap) return [];
    const hw = width / 2 * mpp, hh = height / 2 * mpp;
    const minE = c.e - hw, maxE = c.e + hw, minN = c.n - hh, maxN = c.n + hh;
    const res: Array<{ key: number; color: string; d: string }> = [];
    basemap.lines.forEach((l, idx) => {
      const lay = basemap.layers[l.layer];
      if (!lay?.visible) return;
      let lo = Infinity, hiE = -Infinity, loN = Infinity, hiN = -Infinity;
      for (let k = 0; k < l.pts.length; k += 2) {
        lo = Math.min(lo, l.pts[k]); hiE = Math.max(hiE, l.pts[k]);
        loN = Math.min(loN, l.pts[k + 1]); hiN = Math.max(hiN, l.pts[k + 1]);
      }
      if (hiE < minE || lo > maxE || hiN < minN || loN > maxN) return;
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

  const inView = (x: number, y: number) => x > -20 && y > -20 && x < width + 20 && y < height + 20;
  const labels = showLabels && mpp <= 1.5;

  // масштабная линейка: круглое число метров ~ 60–120 px
  const bar = useMemo(() => {
    const target = mpp * 90;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map((k) => k * pow).find((v) => v / mpp >= 60) ?? 10 * pow;
    return { m: step, px: step / mpp };
  }, [mpp]);

  const B = compact ? 36 : 46;
  return (
    <View style={[styles.wrap, { width, height }]} {...pan.panHandlers}>
      <Svg width={width} height={height}>
        {visible.map((v) => (
          <Polyline key={v.key} points={v.d} fill="none" stroke={v.color} strokeWidth={1.3} opacity={0.9} />
        ))}
        {lines?.map((l, i) => {
          const d: string[] = [];
          for (let k = 0; k + 1 < l.pts.length; k += 2) {
            const [x, y] = toPx(l.pts[k], l.pts[k + 1]);
            d.push(`${x.toFixed(1)},${y.toFixed(1)}`);
          }
          return <Polyline key={i} points={d.join(' ')} fill="none" stroke={l.color} strokeWidth={2} />;
        })}
        {here && target && (() => {
          const [x1, y1] = toPx(here.east, here.north); const [x2, y2] = toPx(target.east, target.north);
          return <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.accent} strokeWidth={2} strokeDasharray="6,4" />;
        })()}
        {showKnown && mpp <= 5 && known.map((k) => {
          const [x, y] = toPx(k.east, k.north);
          if (!inView(x, y)) return null;
          return (
            <G key={k.id}>
              <Polygon points={`${x},${y - 6} ${x - 5.5},${y + 4} ${x + 5.5},${y + 4}`} fill="none" stroke="#FFD24B" strokeWidth={1.5} />
              {labels && <SvgText x={x + 7} y={y + 4} fill="#FFD24B" fontSize={10}>{k.name}</SvgText>}
            </G>
          );
        })}
        {points.map((p) => {
          const [x, y] = toPx(p.east, p.north);
          if (!inView(x, y)) return null;
          return (
            <G key={p.id}>
              <Circle cx={x} cy={y} r={4.5} fill={p.color ?? colors.accent} stroke={colors.bg} strokeWidth={1} />
              {labels && <SvgText x={x + 7} y={y + 4} fill={colors.textPrimary} fontSize={10}>{p.name}</SvgText>}
            </G>
          );
        })}
        {here && (() => {
          const [x, y] = toPx(here.east, here.north);
          return (
            <G>
              <Circle cx={x} cy={y} r={13} fill="none" stroke={colors.fix} strokeWidth={1.5} opacity={0.6} />
              <Line x1={x - 18} y1={y} x2={x + 18} y2={y} stroke={colors.fix} strokeWidth={1} opacity={0.7} />
              <Line x1={x} y1={y - 18} x2={x} y2={y + 18} stroke={colors.fix} strokeWidth={1} opacity={0.7} />
              <Circle cx={x} cy={y} r={4.5} fill={colors.fix} stroke={colors.bg} strokeWidth={2} />
            </G>
          );
        })()}
      </Svg>

      <View style={styles.scaleBox} pointerEvents="none">
        <View style={[styles.scaleBar, { width: bar.px }]} />
        <Text style={styles.scaleT}>{bar.m >= 1 ? `${bar.m} м` : `${Math.round(bar.m * 100)} см`}</Text>
      </View>
      <Text style={styles.north} pointerEvents="none">С ↑</Text>

      <View style={styles.btns}>
        <MapBtn size={B} label="＋" onPress={() => setView({ ...c, mpp: clampMpp(mpp / 2) })} />
        <MapBtn size={B} label="－" onPress={() => setView({ ...c, mpp: clampMpp(mpp * 2) })} />
        <MapBtn size={B} label="◎" active={follow} disabled={!here}
          onPress={() => { if (here) { setFollow(true); setView({ n: here.north, e: here.east, mpp: Math.min(mpp, 1) }); } }} />
        <MapBtn size={B} label="⤢" onPress={() => { setFollow(false); setView(fitAll()); }} />
      </View>
    </View>
  );
}

function MapBtn({ label, onPress, size, active, disabled }: {
  label: string; onPress: () => void; size: number; active?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={[styles.btn, { width: size, height: size, opacity: disabled ? 0.4 : 1 }, active && { borderColor: colors.fix }]}>
      <Text style={[styles.btnT, active && { color: colors.fix }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#05080C', borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  scaleBox: { position: 'absolute', bottom: 8, left: 10 },
  scaleBar: { height: 4, borderLeftWidth: 1.5, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.textSecondary },
  scaleT: { color: colors.textSecondary, fontSize: font.caption, marginTop: 2 },
  north: { position: 'absolute', top: 8, left: 10, color: colors.textSecondary, fontSize: font.small, fontWeight: '800' },
  btns: { position: 'absolute', right: 8, top: 8, gap: 8 },
  btn: {
    borderRadius: 10, backgroundColor: colors.surfaceRaised + 'E6',
    borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center',
  },
  btnT: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
});
