import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, space, font } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Tile } from '../../src/components/Tile';

export default function CogoScreen() {
  const router = useRouter();
  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}>
      <Text style={styles.hint}>
        Геодезические калькуляторы. Работают с плоскими координатами N/E (метры).
      </Text>
      <View style={styles.grid}>
        <Tile label="ПГЗ (прямая)" icon="arrow-forward-circle" onPress={() => router.push('/cogo/pgz')} />
        <Tile label="ОГЗ (обратная)" icon="swap-horizontal" onPress={() => router.push('/cogo/ogz')} />
        <Tile label="Площадь" icon="square-outline" onPress={() => router.push('/cogo/area')} />
        <Tile label="Углы ГМС" icon="pie-chart-outline" onPress={() => router.push('/cogo/angles')} />
        <Tile label="Осреднение" icon="stats-chart" onPress={() => router.push('/cogo/average')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textMuted, fontSize: font.small, marginBottom: space.xl, lineHeight: 19 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
});
