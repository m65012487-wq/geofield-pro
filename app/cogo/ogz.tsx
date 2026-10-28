import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { space } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Button } from '../../src/components/ui';
import { NumField, parseNum } from '../../src/components/NumField';
import { inverse, fmtDms } from '../../src/lib/cogo';

/** ОГЗ: две точки → расстояние и азимут. */
export default function OgzScreen() {
  const [n1, setN1] = useState('');
  const [e1, setE1] = useState('');
  const [n2, setN2] = useState('');
  const [e2, setE2] = useState('');
  const [res, setRes] = useState<{ distance: number; azimuthDeg: number } | null>(null);
  const [err, setErr] = useState('');

  const calc = () => {
    const vals = [parseNum(n1), parseNum(e1), parseNum(n2), parseNum(e2)];
    if (vals.some(Number.isNaN)) { setErr('Заполните все поля числами.'); setRes(null); return; }
    setErr('');
    setRes(inverse({ n: vals[0], e: vals[1] }, { n: vals[2], e: vals[3] }));
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}
      keyboardShouldPersistTaps="handled">
      <Text style={shared.muted}>
        Обратная геодезическая задача: по двум точкам вычисляет расстояние и азимут 1→2.
      </Text>
      <Text style={shared.sectionTitle}>{'\n'}Точка 1</Text>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <NumField label="N, м" value={n1} onChange={setN1} flex />
        <NumField label="E, м" value={e1} onChange={setE1} flex />
      </View>
      <Text style={shared.sectionTitle}>{'\n'}Точка 2</Text>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <NumField label="N, м" value={n2} onChange={setN2} flex />
        <NumField label="E, м" value={e2} onChange={setE2} flex />
      </View>
      <Button label="Вычислить" onPress={calc} style={{ marginTop: space.lg }} />
      {!!err && <Text style={[shared.muted, { marginTop: space.md }]}>{err}</Text>}
      {res && (
        <View style={shared.resultBox}>
          <View>
            <Text style={shared.resultLabel}>Расстояние</Text>
            <Text style={shared.resultValue}>{res.distance.toFixed(3)} м</Text>
          </View>
          <View>
            <Text style={shared.resultLabel}>Азимут</Text>
            <Text style={shared.resultValue}>{res.azimuthDeg.toFixed(4)}°  ({fmtDms(res.azimuthDeg)})</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
