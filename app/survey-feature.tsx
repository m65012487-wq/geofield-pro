import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, TextInput, Modal, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors, space, font } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card, QualityBadge } from '../src/components/ui';
import { SurveyCanvas } from '../src/components/SurveyCanvas';
import { useGnss } from '../src/lib/useGnss';
import { useActiveProject } from '../src/lib/useActiveProject';
import { listPoints, listFeatures, addFeature, countFeatures } from '../src/db/database';
import type { SurveyPoint, Feature, Vertex } from '../src/db/types';

const CANVAS_H = 300;

/** Съёмка линии или полигона: обход с фиксацией вершин. */
export default function SurveyFeatureScreen() {
  const { type } = useLocalSearchParams<{ type: 'line' | 'polygon' }>();
  const featureType: 'line' | 'polygon' = type === 'polygon' ? 'polygon' : 'line';
  const isPoly = featureType === 'polygon';
  const minVertices = isPoly ? 3 : 2;

  const router = useRouter();
  const { project } = useActiveProject();
  const { position } = useGnss();

  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [canvasW, setCanvasW] = useState(0);
  const [saveModal, setSaveModal] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const load = useCallback(() => {
    if (!project) return;
    listPoints(project.id).then(setPoints);
    listFeatures(project.id).then(setFeatures);
  }, [project?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addVertex = () => {
    if (!position) { Alert.alert('Нет сигнала GPS'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setVertices((prev) => [...prev, {
      lat: position.latitude, lon: position.longitude, elev: position.elevation,
    }]);
  };

  const undoVertex = () => setVertices((prev) => prev.slice(0, -1));

  const openSave = async () => {
    if (vertices.length < minVertices) {
      Alert.alert('Мало вершин', `${isPoly ? 'Полигону' : 'Линии'} нужно минимум ${minVertices}.`);
      return;
    }
    if (!project) return;
    const n = await countFeatures(project.id, featureType);
    setName((isPoly ? 'PG' : 'LN') + String(n + 1).padStart(3, '0'));
    setCode('');
    setSaveModal(true);
  };

  const handleSave = async () => {
    if (!project) return;
    await addFeature({
      projectId: project.id, type: featureType,
      name: name.trim() || (isPoly ? 'PG' : 'LN'),
      code: code.trim(), vertices,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSaveModal(false);
    setVertices([]);
    load();
  };

  if (!project) {
    return (
      <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={shared.muted}>Сначала выберите проект.</Text>
      </View>
    );
  }

  return (
    <View style={shared.container}>
      <Stack.Screen options={{ title: isPoly ? 'Съёмка полигона' : 'Съёмка линии' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 200 }}>
        <Card style={styles.statusCard}>
          <View style={shared.row}>
            <Text style={styles.statusText}>
              Вершин: <Text style={styles.statusNum}>{vertices.length}</Text> (мин. {minVertices})
            </Text>
            <View style={{ flex: 1 }} />
            <QualityBadge quality={position?.quality ?? 'none'} />
          </View>
          {position && (
            <Text style={styles.accText}>Точность: ±{position.hAccuracy.toFixed(2)} м</Text>
          )}
        </Card>

        <View onLayout={(e) => setCanvasW(e.nativeEvent.layout.width)}>
          {canvasW > 0 && (
            <SurveyCanvas position={position} points={points} features={features}
              draft={vertices.map((v) => ({ lat: v.lat, lon: v.lon }))}
              width={canvasW} height={CANVAS_H} />
          )}
        </View>

        <Text style={[shared.muted, { marginTop: space.md, lineHeight: 19 }]}>
          Идите вдоль объекта и фиксируйте вершины кнопкой. Пунктир — снимаемый контур.
          {isPoly ? ' Полигон замкнётся автоматически.' : ''}
        </Text>
      </ScrollView>

      <View style={styles.bottomBar}>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label="↩ Отменить" variant="secondary" onPress={undoVertex}
            disabled={vertices.length === 0} style={{ flex: 1 }} />
          <Button label="Завершить" variant="secondary" onPress={openSave}
            disabled={vertices.length < minVertices} style={{ flex: 1 }} />
        </View>
        <Button label={position ? '◉  ВЕРШИНА' : 'Ожидание GPS…'} onPress={addVertex} disabled={!position} />
      </View>

      <Modal visible={saveModal} transparent animationType="slide" onRequestClose={() => setSaveModal(false)}>
        <View style={shared.modalOverlay}>
          <View style={shared.modalSheet}>
            <Text style={shared.modalTitle}>{isPoly ? 'Сохранить полигон' : 'Сохранить линию'}</Text>
            <Text style={shared.muted}>{vertices.length} вершин</Text>
            <Text style={shared.label}>Имя</Text>
            <TextInput style={shared.input} value={name} onChangeText={setName}
              placeholderTextColor={colors.textMuted} />
            <Text style={shared.label}>Код объекта</Text>
            <TextInput style={shared.input} value={code} onChangeText={setCode}
              placeholder="ЗАБОР / ДОР / ..." placeholderTextColor={colors.textMuted} />
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <Button label="Отмена" variant="secondary" onPress={() => setSaveModal(false)} style={{ flex: 1 }} />
              <Button label="Сохранить" onPress={handleSave} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  statusCard: { marginBottom: space.lg },
  statusText: { color: colors.textPrimary, fontSize: font.body },
  statusNum: { color: colors.accent, fontWeight: '800' },
  accText: { color: colors.textMuted, fontSize: font.small, marginTop: 6 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: space.lg, gap: space.md,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
});
