import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, Pressable, Modal, FlatList } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, space, font, radius } from '../src/theme/theme';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { HelpButton, ScreenHelp } from '../src/components/Help';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useCalibration, localOf } from '../src/lib/calibStore';
import { listFeatures, listPoints } from '../src/db/database';
import type { Feature, SurveyPoint } from '../src/db/types';
import { sanitizeName, shareFile, writeCacheFile } from '../src/lib/exporter';
import { defaultLayers, layerQty, loadLayers, saveLayers, type MatLayer } from '../src/lib/materials';

const CRLF = String.fromCharCode(13, 10);
const BOM = String.fromCharCode(0xfeff);
const csvN = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '');
const fmt = (v: number, d: number) => v.toFixed(d).replace('.', ',');

type NE = { n: number; e: number };

/** Площадь по формуле трапеций (Σ (Nᵢ₊₁ − Nᵢ)(Eᵢ₊₁ + Eᵢ) / 2) и периметр замкнутого контура. */
function areaPerimeter(pts: NE[]): { area: number; perimeter: number } {
  let s = 0, per = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += (b.n - a.n) * (b.e + a.e) / 2;
    per += Math.hypot(b.n - a.n, b.e - a.e);
  }
  return { area: Math.abs(s), perimeter: per };
}

/**
 * Площадь контура в плане и расход материалов по слоям (дорожная одежда, песок, щебень, асфальт).
 * Контур — полигон из «Линий и полигонов» либо точки проекта в порядке обхода.
 */
export default function AreaScreen() {
  const { project } = useActiveProject();
  const calib = useCalibration(project?.id);
  const [source, setSource] = useState<'polygon' | 'points'>('polygon');
  const [polys, setPolys] = useState<Feature[]>([]);
  const [polyId, setPolyId] = useState<string | null>(null);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [layers, setLayers] = useState<MatLayer[]>(defaultLayers());
  const loaded = useRef(false);

  useFocusEffect(useCallback(() => {
    if (!project) return;
    listFeatures(project.id, 'polygon').then((f) => {
      setPolys(f);
      setPolyId((cur) => (cur && f.some((x) => x.id === cur) ? cur : f[0]?.id ?? null));
    });
    listPoints(project.id).then(setPoints);
  }, [project?.id]));

  useEffect(() => {
    loadLayers().then((l) => { setLayers(l); loaded.current = true; });
  }, []);

  const updateLayers = (next: MatLayer[]) => {
    setLayers(next);
    if (loaded.current) saveLayers(next).catch(() => {});
  };
  const patch = (id: string, p: Partial<MatLayer>) => updateLayers(layers.map((l) => (l.id === id ? { ...l, ...p } : l)));

  const contour: NE[] = useMemo(() => {
    if (source === 'polygon') {
      const f = polys.find((x) => x.id === polyId);
      if (!f) return [];
      const out: NE[] = [];
      for (const v of f.vertices) {
        const l = localOf(calib, v.lat, v.lon, v.elev);
        if (l) out.push({ n: l.north, e: l.east });
      }
      return out;
    }
    const out: NE[] = [];
    for (const id of order) {
      const p = points.find((x) => x.id === id);
      if (!p) continue;
      if (p.north != null && p.east != null) { out.push({ n: p.north, e: p.east }); continue; }
      const l = localOf(calib, p.latitude, p.longitude, p.elevation);
      if (l) out.push({ n: l.north, e: l.east });
    }
    return out;
  }, [source, polys, polyId, points, order, calib]);

  const res = contour.length >= 3 ? areaPerimeter(contour) : null;
  const results = useMemo(() => (res ? layers.map((l) => layerQty(l, res.area)) : []), [res, layers]);
  const sumThick = layers.reduce((s, l) => { const t = parseFloat(l.thick.replace(',', '.')); return s + (Number.isFinite(t) ? t : 0); }, 0);

  const exportCsv = async () => {
    if (!project || !res) return;
    try {
      const src = source === 'polygon' ? `полигон: ${polys.find((x) => x.id === polyId)?.name ?? ''}` : `точки: ${order.length}`;
      const out: string[] = [];
      out.push(`Площадь и материалы;${project.name}`);
      out.push(`Контур;${src}`);
      out.push(`Площадь в плане, м²;${csvN(res.area, 2)}`);
      out.push(`Периметр, м;${csvN(res.perimeter, 2)}`);
      out.push(`Сформировано ${new Date().toLocaleString('ru-RU')}`);
      out.push('');
      out.push('№;Слой;Толщина, см;Расчёт;Коэффициент / расход;Количество;Ед.');
      results.forEach((r, k) => {
        out.push([
          k + 1, r.layer.name, r.layer.thick.replace('.', ','),
          r.layer.mode === 'm3' ? 'объём с коэффициентом' : 'расход т/м²', r.layer.k.replace('.', ','),
          r.ok ? csvN(r.qty, 2) : '', r.unit,
        ].join(';'));
      });
      const f = writeCacheFile(`${sanitizeName(project.name)}_материалы.csv`, BOM + out.join(CRLF) + CRLF);
      await shareFile(f, 'text/csv', 'Материалы');
    } catch (e) {
      Alert.alert('Не удалось выгрузить', e instanceof Error ? e.message : String(e));
    }
  };

  const reset = () => {
    Alert.alert('Сбросить слои?', 'Таблица вернётся к дорожной одежде съезда (51 см).', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сбросить', style: 'destructive', onPress: () => updateLayers(defaultLayers()) },
    ]);
  };

  if (!project) {
    return <View style={[shared.container, { alignItems: 'center', justifyContent: 'center' }]}><Text style={shared.muted}>Сначала выберите проект.</Text></View>;
  }

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad} keyboardShouldPersistTaps="handled">
      <ScreenHelp title="Площадь и материалы" text={HELP} />

      <Card>
        <Text style={styles.title}>Контур</Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip label="Полигон" on={source === 'polygon'} onPress={() => setSource('polygon')} />
          <Chip label="Из точек" on={source === 'points'} onPress={() => setSource('points')} />
        </View>

        {source === 'polygon' ? (
          <View style={{ marginTop: space.md }}>
            {polys.length === 0 && <Text style={shared.muted}>В «Линиях и полигонах» нет полигонов.</Text>}
            {polys.map((f) => (
              <Pressable key={f.id} style={[styles.item, f.id === polyId && styles.itemOn]} onPress={() => setPolyId(f.id)}>
                <Text style={styles.itemName}>{f.name}</Text>
                <Text style={styles.itemVal}>{f.vertices.length} вершин</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={{ marginTop: space.md }}>
            <Text style={shared.muted}>Порядок выбора = порядок обхода контура.</Text>
            {order.map((id, k) => {
              const p = points.find((x) => x.id === id);
              return (
                <View key={id} style={styles.item}>
                  <Text style={styles.itemName}>{k + 1}. {p?.name ?? '?'}{p?.code ? ` · ${p.code}` : ''}</Text>
                  <Pressable hitSlop={10} onPress={() => setOrder(order.filter((x) => x !== id))}>
                    <Text style={{ color: colors.danger, fontSize: font.bodyLg }}>✕</Text>
                  </Pressable>
                </View>
              );
            })}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Button label="Выбрать точки" variant="secondary" style={{ flex: 1 }} onPress={() => setPicking(true)} />
              {order.length > 0 && <Button label="Очистить" variant="secondary" onPress={() => setOrder([])} />}
            </View>
          </View>
        )}
        {contour.length < 3 && <Text style={styles.warn}>Для площади нужно минимум 3 вершины с местными координатами (калибровка).</Text>}
      </Card>

      {res && (
        <View style={shared.resultBox}>
          <Text style={shared.resultLabel}>Площадь в плане</Text>
          <Text style={shared.resultValue}>{fmt(res.area, 2)} м²</Text>
          <Text style={shared.resultLabel}>Периметр</Text>
          <Text style={shared.resultValue}>{fmt(res.perimeter, 2)} м</Text>
        </View>
      )}

      <Card style={{ marginTop: space.lg }}>
        <View style={shared.row}>
          <Text style={[styles.title, { flex: 1, marginBottom: 0 }]}>Слои материалов ({fmt(sumThick, 1)} см)</Text>
          <HelpButton size={20} title="Слои материалов" text={HELP_LAYERS} />
        </View>
        {layers.map((l, k) => {
          const r = results[k];
          return (
            <View key={l.id} style={styles.layer}>
              <TextInput style={shared.input} value={l.name} onChangeText={(v) => patch(l.id, { name: v })}
                placeholder="Название слоя" placeholderTextColor={colors.textMuted} />
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={shared.label}>Толщина, см</Text>
                  <TextInput style={shared.input} value={l.thick} onChangeText={(v) => patch(l.id, { thick: v })}
                    keyboardType="numbers-and-punctuation" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={shared.label}>{l.mode === 'm3' ? 'Коэффициент' : 'Расход, т/м²'}</Text>
                  <TextInput style={shared.input} value={l.k} onChangeText={(v) => patch(l.id, { k: v })}
                    keyboardType="numbers-and-punctuation" />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm, alignItems: 'center' }}>
                <Chip label="м³ с коэфф." on={l.mode === 'm3'} onPress={() => patch(l.id, { mode: 'm3' })} />
                <Chip label="т по расходу" on={l.mode === 't'} onPress={() => patch(l.id, { mode: 't' })} />
                <View style={{ flex: 1 }} />
                <Pressable hitSlop={10} onPress={() => updateLayers(layers.filter((x) => x.id !== l.id))}>
                  <Text style={{ color: colors.danger, fontSize: font.small }}>Удалить</Text>
                </Pressable>
              </View>
              {r && <Text style={styles.qty}>{r.ok ? `${fmt(r.qty, 2)} ${r.unit}` : 'проверьте числа'}</Text>}
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <Button label="+ Слой" variant="secondary" style={{ flex: 1 }}
            onPress={() => updateLayers([...layers, { id: `l${Date.now()}`, name: 'Новый слой', thick: '10', mode: 'm3', k: '1' }])} />
          <Button label="Сбросить к одежде съезда" variant="secondary" style={{ flex: 2 }} onPress={reset} />
        </View>
      </Card>

      <Button label="CSV" onPress={exportCsv} disabled={!res} style={{ marginTop: space.lg }} />

      <PointsPicker
        visible={picking}
        points={points}
        order={order}
        onChange={setOrder}
        onClose={() => setPicking(false)}
      />
    </ScrollView>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && { color: colors.accentText }]}>{label}</Text>
    </Pressable>
  );
}

/** Мультивыбор точек: порядок нажатий = порядок обхода. */
function PointsPicker({ visible, points, order, onChange, onClose }: {
  visible: boolean; points: SurveyPoint[]; order: string[]; onChange: (o: string[]) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? points.filter((p) => p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)) : points;
  }, [points, q]);
  const toggle = (id: string) => onChange(order.includes(id) ? order.filter((x) => x !== id) : [...order, id]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={shared.modalOverlay}>
        <View style={[shared.modalSheet, { maxHeight: '85%' }]}>
          <Text style={shared.modalTitle}>Точки контура ({order.length})</Text>
          <TextInput style={shared.input} value={q} onChangeText={setQ} placeholder="Поиск по имени или коду"
            placeholderTextColor={colors.textMuted} autoCapitalize="none" />
          <FlatList
            style={{ marginTop: space.sm }}
            data={list}
            extraData={order}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={shared.muted}>Ничего не найдено.</Text>}
            renderItem={({ item }) => {
              const idx = order.indexOf(item.id);
              return (
                <Pressable style={[styles.item, idx >= 0 && styles.itemOn]} onPress={() => toggle(item.id)}>
                  <Text style={styles.itemName}>{item.name}{item.code ? ` · ${item.code}` : ''}</Text>
                  <Text style={[styles.itemVal, idx >= 0 && { color: colors.accent, fontWeight: '800' }]}>{idx >= 0 ? `№ ${idx + 1}` : ''}</Text>
                </Pressable>
              );
            }}
          />
          <Button label="Готово" onPress={onClose} style={{ marginTop: space.md }} />
        </View>
      </View>
    </Modal>
  );
}

const HELP = [
  'Считает площадь контура в плане и сколько материалов нужно по слоям: песок, щебень, асфальт.',
  '',
  'Как пользоваться:',
  '1. Выберите контур. «Полигон» — готовый полигон из «Линий и полигонов». «Из точек» — нажимайте точки по очереди вокруг контура: порядок выбора и есть порядок обхода (по часовой или против — всё равно, без самопересечений).',
  '2. Внизу появятся площадь и периметр.',
  '3. В таблице слоёв поправьте названия, толщины и коэффициенты. Таблица запоминается на телефоне.',
  '4. «CSV» выгружает результат для Excel. «Сбросить к одежде съезда» возвращает слои съезда 51 см.',
  '',
  'Ограничения: нужна калибровка проекта. Для съезда площадь берётся по контуру асфальта, без уширения основания — так решил заказчик. Площадь в плане, не по откосу.',
].join('\n');

const HELP_LAYERS = [
  'Два режима расчёта слоя:',
  '• «м³ с коэфф.» — объём = площадь × толщина × коэффициент уплотнения (для песка, щебня, ПГС; больше 1, т.к. укладывают рыхлым и уплотняют).',
  '• «т по расходу» — масса = площадь × расход в т/м² (для асфальта; толщина тут справочная и уже учтена в расходе).',
  '',
  'Исходно стоит одежда съезда: ПГС 25 см ×1,2667; щебень М1200 фр. 40–70 5 см ×1,26; щебень М600 фр. 20–40 10 см ×1,26; а/б А22НН 6 см 0,1389 т/м²; а/б А16ВН 5 см 0,1208 т/м².',
].join('\n');

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, fontSize: font.bodyLg, fontWeight: '800', marginBottom: space.sm },
  warn: { color: colors.warning, fontSize: font.small, marginTop: space.sm },
  chip: {
    paddingHorizontal: space.md, minHeight: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textPrimary, fontSize: font.small, fontWeight: '700' },
  item: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  itemOn: { backgroundColor: colors.accentBg },
  itemName: { color: colors.textPrimary, fontSize: font.body, flexShrink: 1 },
  itemVal: { color: colors.textSecondary, fontSize: font.small },
  layer: { marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  qty: { color: colors.accent, fontSize: font.bodyLg, fontWeight: '800', marginTop: space.sm },
});
