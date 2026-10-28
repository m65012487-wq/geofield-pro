import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder, type LayoutChangeEvent } from 'react-native';
import { colors } from '../theme/theme';
import { kvGet, kvSet } from '../db/database';

const SIZE = 84;
const MOVE = 8; // сдвиг пальца больше этого — перетаскивание, меньше — нажатие

interface Props {
  label: string;
  color: string;
  running: boolean;
  onPress: () => void;
}

/**
 * Плавающая кнопка «Измерить» поверх экрана, как в LandStar: нажать — снять, тащить — переставить.
 * Место запоминается долями экрана (kv shutterPos), общее для «Съёмки» и «Карты».
 */
export function FloatingShutter({ label, color, running, onPress }: Props) {
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const cur = useRef({ x: 0, y: 0 });
  const areaRef = useRef({ w: 0, h: 0 });
  const moved = useRef(false);
  const pressRef = useRef(onPress);
  pressRef.current = onPress;

  const clamp = (x: number, y: number) => ({
    x: Math.max(4, Math.min(areaRef.current.w - SIZE - 4, x)),
    y: Math.max(4, Math.min(areaRef.current.h - SIZE - 4, y)),
  });

  useEffect(() => {
    if (!area) return;
    areaRef.current = area;
    kvGet('shutterPos').then((v) => {
      let p = { x: area.w - SIZE - 16, y: area.h * 0.55 };
      if (v) try { const s = JSON.parse(v); p = { x: s.fx * area.w, y: s.fy * area.h }; } catch { /* по умолчанию */ }
      p = clamp(p.x, p.y);
      cur.current = p;
      pos.setValue(p);
    });
  }, [area?.w, area?.h]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { moved.current = false; },
    onPanResponderMove: (_, g) => {
      if (!moved.current && Math.abs(g.dx) + Math.abs(g.dy) > MOVE) moved.current = true;
      if (moved.current) pos.setValue(clamp(cur.current.x + g.dx, cur.current.y + g.dy));
    },
    onPanResponderRelease: (_, g) => {
      if (!moved.current) { pressRef.current(); return; }
      const p = clamp(cur.current.x + g.dx, cur.current.y + g.dy);
      cur.current = p;
      const { w, h } = areaRef.current;
      kvSet('shutterPos', JSON.stringify({ fx: p.x / w, fy: p.y / h }));
    },
  }), []);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setArea({ w: width, h: height });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onLayout}>
      {area && (
        <Animated.View {...pan.panHandlers}
          style={[styles.btn, { backgroundColor: running ? colors.dangerBg : color, borderColor: running ? colors.danger : '#ffffffcc' },
            { transform: pos.getTranslateTransform() }]}>
          <Text style={[styles.icon, running && { color: colors.danger }]}>{running ? '■' : '◉'}</Text>
          <Text style={[styles.label, running && { color: colors.danger }]} numberOfLines={1}>{label}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, borderRadius: SIZE / 2,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3,
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  icon: { color: '#fff', fontSize: 26, fontWeight: '900', lineHeight: 30 },
  label: { color: '#fff', fontSize: 13, fontWeight: '800', maxWidth: SIZE - 10 },
});
