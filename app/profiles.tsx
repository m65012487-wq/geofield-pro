import React, { useState } from 'react';
import { ScrollView, Text, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { ScreenHelp } from '../src/components/Help';
import { getDb } from '../src/db/database';

export const PRESETS = [
  { name: 'Асфальт и обочины', epochs: 1, seq: 'OBL,DOR,OBP', code: 'DOR', text: 'Одна эпоха для дороги и обочин, три для съездов. Поперечник OBL → DOR → OBP.' },
  { name: 'Кюветы и отсыпка', epochs: 2, seq: 'KUV,OTK', code: 'KUV', text: 'По две эпохи на точку. Последовательность кювет → отсыпка.' },
  { name: 'Контроль съездов', epochs: 3, seq: 'SEZ', code: 'SEZ', text: 'По три эпохи на точку. Автоматическая смена кода отключена.' },
  { name: 'Универсальная съёмка', epochs: 2, seq: 'OBL,DOR,OBP', code: '', text: 'По две эпохи для всех кодов. Последовательность отключена, текущий код сохраняется.' },
];
export default function Profiles() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const apply = async (p: typeof PRESETS[number]) => {
    setBusy(true);
    try {
      const db = await getDb();
      await db.withTransactionAsync(async () => {
        const values: Record<string,string> = { avgEpochs: String(p.epochs), codeEpochs: JSON.stringify(p.code === 'DOR' ? { DOR:1, OBL:1, OBP:1, SEZ:3 } : {}), shotSeq:p.seq, shotSeqOn:p.code === 'DOR' || p.code === 'KUV' ? '1':'0', waitFix:'1', workProfile:p.name };
        if (p.code) values.mapCode = p.code;
        for (const [key,value] of Object.entries(values)) await db.runAsync('INSERT OR REPLACE INTO kv (key,value) VALUES (?,?)', key,value);
      });
      router.back();
    } catch { Alert.alert('Профиль не применён', 'Не удалось сохранить настройки. Попробуйте ещё раз.'); }
    finally { setBusy(false); }
  };
  return <ScrollView style={shared.container} contentContainerStyle={{padding:16,gap:12}}>
    <ScreenHelp title="Профили съёмки" text="Профиль задаёт число эпох, начальный код и порядок объектов. Включает ожидание FIX. Допуски, высота вехи, наклон и существующие точки сохраняются. Настройки профиля общие для приложения; после применения их можно изменить в настройках. Число эпох само по себе не гарантирует точность." />
    <Text style={shared.muted}>Готовые настройки. Все коды остаются доступны. Допуски и высота вехи сохраняются.</Text>
    {PRESETS.map(p => <Card key={p.name}><Text style={shared.sectionTitle}>{p.name}</Text><Text style={shared.muted}>{p.text}</Text><Button label="Применить" disabled={busy} onPress={() => apply(p)} style={{marginTop:12}} /></Card>)}
  </ScrollView>;
}
