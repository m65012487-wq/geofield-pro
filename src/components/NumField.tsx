import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { colors } from '../theme/theme';
import { shared } from '../theme/shared';

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  flex?: boolean;
}

/** Числовое поле COGO-калькуляторов. */
export function NumField({ label, value, onChange, placeholder, flex }: Props) {
  return (
    <View style={flex ? { flex: 1 } : undefined}>
      <Text style={shared.label}>{label}</Text>
      <TextInput
        style={shared.input}
        value={value}
        onChangeText={onChange}
        keyboardType="numbers-and-punctuation"
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

/** Парсит число с запятой или точкой; NaN если пусто/мусор. */
export function parseNum(s: string): number {
  const v = parseFloat(s.replace(',', '.').trim());
  return v;
}
