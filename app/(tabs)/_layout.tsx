import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Проект',
          tabBarIcon: ({ color, size }) => <Ionicons name="folder-open" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: 'Работа',
          tabBarIcon: ({ color, size }) => <Ionicons name="locate" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="cogo"
        options={{
          title: 'Задачи',
          tabBarIcon: ({ color, size }) => <Ionicons name="calculator" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Настр.',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-sharp" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
