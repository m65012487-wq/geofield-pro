import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDatabase } from '../src/db/database';
import { colors, font } from '../src/theme/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initDatabase()
      .then(() => setReady(true))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка БД'));
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errTitle}>Не удалось запустить базу данных</Text>
        <Text style={styles.errText}>{error}</Text>
      </View>
    );
  }
  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loading}>GeoField Pro</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.textPrimary,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="survey" options={{ title: 'Съёмка точек' }} />
          <Stack.Screen name="survey-feature" options={{ title: 'Съёмка объекта' }} />
          <Stack.Screen name="points" options={{ title: 'БД точек' }} />
          <Stack.Screen name="features" options={{ title: 'Линии и полигоны' }} />
          <Stack.Screen name="stakeout" options={{ title: 'Вынос точки' }} />
          <Stack.Screen name="codes" options={{ title: 'Библиотека кодов' }} />
          <Stack.Screen name="export" options={{ title: 'Экспорт' }} />
          <Stack.Screen name="cogo/pgz" options={{ title: 'ПГЗ — прямая задача' }} />
          <Stack.Screen name="cogo/ogz" options={{ title: 'ОГЗ — обратная задача' }} />
          <Stack.Screen name="cogo/area" options={{ title: 'Площадь' }} />
          <Stack.Screen name="cogo/angles" options={{ title: 'Углы' }} />
          <Stack.Screen name="cogo/average" options={{ title: 'Осреднение' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loading: { color: colors.accent, fontSize: font.title, fontWeight: '800', letterSpacing: 1 },
  errTitle: { color: colors.danger, fontSize: font.bodyLg, fontWeight: '700' },
  errText: { color: colors.textSecondary, fontSize: font.body, paddingHorizontal: 32, textAlign: 'center' },
});
