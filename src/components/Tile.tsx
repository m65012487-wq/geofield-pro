import React from 'react';
import { Pressable, Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, space, radius, font } from '../theme/theme';

interface TileProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  badge?: string;
}

/** Крупная плитка меню в стиле LandStar — 3 в ряд, под перчатки. */
export function Tile({ label, icon, onPress, disabled, badge }: TileProps) {
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [styles.tile, { opacity: disabled ? 0.35 : pressed ? 0.8 : 1 }]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={30} color={colors.accent} />
        {badge != null && (
          <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>
        )}
      </View>
      <Text style={styles.label} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '31%',
    alignItems: 'center',
    marginBottom: space.xl,
  },
  iconWrap: {
    width: 72, height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    position: 'absolute', top: -6, right: -6,
    backgroundColor: colors.accent, borderRadius: radius.pill,
    minWidth: 22, height: 22, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.accentText, fontSize: 11, fontWeight: '800' },
  label: {
    color: colors.textPrimary, fontSize: font.small,
    textAlign: 'center', marginTop: space.sm, lineHeight: 17,
  },
});
