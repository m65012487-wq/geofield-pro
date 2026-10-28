import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { colors, space, font } from '../theme/theme';
import type { ShotEngine } from '../lib/useShot';

/** Переключатели ускоренной съёмки над картой/плитками: поперечник, автосъёмка, замер по остановке. */
export function ShotModes({ shot }: { shot: ShotEngine }) {
  const s = shot.settings;
  if (!s) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Chip on={shot.seqOn} onPress={shot.toggleSeq} label={`⟳ ${s.seq.join('→')}`} />
      <Chip on={shot.autoOn} onPress={shot.toggleAuto} label={`Авто ${s.autoStep} м`} />
      <Chip on={shot.stillOn} onPress={shot.toggleStill} label="По остановке" />
      {shot.waitingFix && <Text style={styles.wait}>жду FIX…</Text>}
    </ScrollView>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipT, on && styles.chipTOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingHorizontal: space.md, paddingVertical: 6, alignItems: 'center' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accent + '33' },
  chipT: { color: colors.textSecondary, fontSize: font.small, fontWeight: '700' },
  chipTOn: { color: colors.textPrimary },
  wait: { color: colors.warning, fontSize: font.small, fontWeight: '800', marginLeft: space.sm },
});
