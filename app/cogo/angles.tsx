import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { space } from '../../src/theme/theme';
import { shared } from '../../src/theme/shared';
import { Button } from '../../src/components/ui';
import { NumField, parseNum } from '../../src/components/NumField';
import { dmsToDeg, fmtDms } from '../../src/lib/cogo';

/** Конвертер углов: десятичные градусы ↔ ГМС. */
export default function AnglesScreen() {
  const [dec, setDec] = useState('');
  const [decRes, setDecRes] = useState('');
  const [d, setD] = useState('');
  const [m, setM] = useState('');
  const [s, setS] = useState('');
  const [dmsRes, setDmsRes] = useState('');

  const toDms = () => {
    const v = parseNum(dec);
    if (Number.isNaN(v)) { setDecRes('Введите число.'); return; }
    setDecRes(fmtDms(v, 2));
  };

  const toDec = () => {
    const dd = parseNum(d) || 0;
    const mm = parseNum(m) || 0;
    const ss = parseNum(s) || 0;
    setDmsRes(dmsToDeg(Math.abs(dd), mm, ss, dd < 0).toFixed(6) + '°');
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.pad}
      keyboardShouldPersistTaps="handled">
      <Text style={shared.sectionTitle}>Градусы → ГМС</Text>
      <NumField label="Десятичные градусы" value={dec} onChange={setDec} placeholder="45.5125" />
      <Button label="Перевести" onPress={toDms} style={{ marginTop: space.md }} />
      {!!decRes && (
        <View style={shared.resultBox}>
          <Text style={shared.resultValue}>{decRes}</Text>
        </View>
      )}

      <Text style={[shared.sectionTitle, { marginTop: space.xxl }]}>ГМС → градусы</Text>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <NumField label="Градусы" value={d} onChange={setD} placeholder="45" flex />
        <NumField label="Минуты" value={m} onChange={setM} placeholder="30" flex />
        <NumField label="Секунды" value={s} onChange={setS} placeholder="45.0" flex />
      </View>
      <Button label="Перевести" onPress={toDec} style={{ marginTop: space.md }} />
      {!!dmsRes && (
        <View style={shared.resultBox}>
          <Text style={shared.resultValue}>{dmsRes}</Text>
        </View>
      )}
    </ScrollView>
  );
}
