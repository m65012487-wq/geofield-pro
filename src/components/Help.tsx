import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { colors, space, font, radius } from '../theme/theme';
import { shared } from '../theme/shared';

export interface HelpText { title: string; text: string }

/** Круглая «?» — открывает подсказку: что делает функция и как ей пользоваться. */
export function HelpButton({ title, text, size = 26 }: HelpText & { size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={12}
        style={[styles.btn, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.q, { fontSize: size * 0.6 }]}>?</Text>
      </Pressable>
      <HelpModal visible={open} title={title} text={text} onClose={() => setOpen(false)} />
    </>
  );
}

export function HelpModal({ visible, title, text, onClose }: HelpText & { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={shared.modalOverlay} onPress={onClose}>
        <View style={[shared.modalSheet, { maxHeight: '80%' }]}>
          <Text style={shared.modalTitle}>{title}</Text>
          <ScrollView>
            <Text style={styles.text}>{text}</Text>
          </ScrollView>
          <Text style={styles.close}>Нажмите, чтобы закрыть</Text>
        </View>
      </Pressable>
    </Modal>
  );
}

/** «?» в шапке экрана. Вставляется в разметку экрана: <ScreenHelp title=… text=… />. */
export function ScreenHelp(h: HelpText) {
  return <Stack.Screen options={{ headerRight: () => <HelpButton {...h} /> }} />;
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1.5, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accentBg,
  },
  q: { color: colors.accent, fontWeight: '900' },
  text: { color: colors.textPrimary, fontSize: font.body, lineHeight: 22 },
  close: { color: colors.textMuted, fontSize: font.caption, textAlign: 'center', marginTop: space.md, borderRadius: radius.md },
});
