import React from 'react';
import {
  Text,
  Pressable,
  View,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius, space, font, TOUCH_TARGET } from '../theme/theme';
import type { FixQuality } from '../db/types';

// ---------- Кнопка ----------

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: ButtonProps) {
  const handle = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress();
  };

  const bg =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.dangerBg
        : colors.surfaceRaised;
  const fg =
    variant === 'primary'
      ? colors.accentText
      : variant === 'danger'
        ? colors.danger
        : colors.textPrimary;
  const border =
    variant === 'secondary' ? colors.borderStrong : 'transparent';

  return (
    <Pressable
      onPress={handle}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnLabel, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

// ---------- Бейдж качества GNSS ----------

const QUALITY_LABEL: Record<FixQuality, string> = {
  fix: 'RTK FIX',
  float: 'FLOAT',
  single: 'SINGLE',
  none: 'НЕТ СИГНАЛА',
};
const QUALITY_COLOR: Record<FixQuality, string> = {
  fix: colors.fix,
  float: colors.float,
  single: colors.single,
  none: colors.noFix,
};

export function QualityBadge({ quality }: { quality: FixQuality }) {
  const c = QUALITY_COLOR[quality];
  return (
    <View style={[styles.badge, { borderColor: c }]}>
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text style={[styles.badgeText, { color: c }]}>{QUALITY_LABEL[quality]}</Text>
    </View>
  );
}

// ---------- Карточка ----------

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  btnLabel: {
    fontSize: font.bodyLg,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    gap: space.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: font.small, fontWeight: '800', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
});
