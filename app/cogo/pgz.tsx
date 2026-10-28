import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { space } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Button } from '../../src/components/ui';
import { NumField, parseNum } from '../../src/components/NumField';
import { forward } from '../../src/lib/cogo';

/** ПГЗ: исходная точка + азимут + расстояние → координаты новой точки. */
export default function PgzScreen() {
  const [n, setN] = useState('');
  const [e, setE] = useState('');
  const [az, setAz] = useState('');
  const [d, setD] = useState('');
  const [res, setRes] = useState<{ n: number; e: number } | null>(null);
  const [err, setErr] = useState('');

  const calc = () => {
    const vals = [parseNum(n), parseNum(e), parseNum(az), parseNum(d)];
    if (vals.some(Number.isNaN)) { setErr('Заполните все поля числами.'); setRes(null); return; }
    setErr('');
    setRes(forward({ n: vals[0], e: vals[1] }, vals[2], vals[3]));
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}
      keyboardShouldPersistTaps="handled">
      <Text style={shared.muted}>
        Прямая геодезическая задача: по точке, азимуту и расстоянию вычисляет новую точку.
      </Text>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <NumField label="N исходной, м" value={n} onChange={setN} placeholder="1000.000" flex />
        <NumField label="E исходной, м" value={e} onChange={setE} placeholder="2000.000" flex />
      </View>
      <NumField label="Азимут, ° (десятичные)" value={az} onChange={setAz} placeholder="45.5" />
      <NumField label="Расстояние, м" value={d} onChange={setD} placeholder="100.000" />
      <Button label="Вычислить" onPress={calc} style={{ marginTop: space.lg }} />
      {!!err && <Text style={[shared.muted, { marginTop: space.md }]}>{err}</Text>}
      {res && (
        <View style={shared.resultBox}>
          <View>
            <Text style={shared.resultLabel}>N новой точки</Text>
            <Text style={shared.resultValue}>{res.n.toFixed(3)} м</Text>
          </View>
          <View>
            <Text style={shared.resultLabel}>E новой точки</Text>
            <Text style={shared.resultValue}>{res.e.toFixed(3)} м</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
