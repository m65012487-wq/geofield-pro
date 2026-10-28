import { StyleSheet } from 'react-native';
import { colors, space, radius, font, TOUCH_TARGET } from './theme';

/** Общие стили для экранов. */
export const shared = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: space.lg },
  label: { color: colors.textSecondary, fontSize: font.small, marginTop: space.sm, marginBottom: 4 },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.textPrimary, fontSize: font.body,
    paddingHorizontal: space.md, minHeight: TOUCH_TARGET,
  },
  sectionTitle: { color: colors.textPrimary, fontSize: font.title, fontWeight: '700', marginBottom: space.md },
  muted: { color: colors.textMuted, fontSize: font.body },
  mono: { fontVariant: ['tabular-nums'] as const },
  row: { flexDirection: 'row', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: space.xl, gap: space.xs,
  },
  modalTitle: { color: colors.textPrimary, fontSize: font.title, fontWeight: '800', marginBottom: space.sm },
  resultBox: {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.accentDim,
    padding: space.lg, marginTop: space.lg, gap: space.sm,
  },
  resultLabel: { color: colors.textMuted, fontSize: font.caption },
  resultValue: { color: colors.accent, fontSize: font.title, fontWeight: '700', fontVariant: ['tabular-nums'] as const },
});
