import React, { useEffect, useState } from 'react';
import { ScrollView, Text, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { shared } from '../src/theme/shared';
import { Button, Card } from '../src/components/ui';
import { ScreenHelp } from '../src/components/Help';
import { useActiveProject } from '../src/lib/useActiveProject';
import { kvGet, kvSet } from '../src/db/database';

export default function ProjectData() {
  const router=useRouter();
  const {project}=useActiveProject();
  const [road,setRoad]=useState(false);
  const [ready,setReady]=useState(false);
  useEffect(()=>{let alive=true;setReady(false);if(project) kvGet(`roadTools:${project.id}`).then(v=>{if(alive){setRoad(v !== '0');setReady(true);}});return()=>{alive=false;};},[project?.id]);
  return <ScrollView style={shared.container} contentContainerStyle={{padding:16,paddingBottom:60,gap:16}}>
    <ScreenHelp title="Данные проекта" text="Для каждого объекта создайте отдельный проект на вкладке Проект. Его чертёж, точки, реперы, трассы и калибровка хранятся отдельно. Подложка: DXF с линиями и полилиниями, координаты X=E, Y=N. DWG заранее сохраните как DXF. Каталог точек: TXT name,N,E,H или LandXML; он загружается в реперы и доступен для выноса. Полная копия GeoField импортируется через Копия и обмен, в том числе отдельным проектом. Название системы координат — описание, а не автоматическое преобразование: для совмещения GNSS с планом нужна калибровка. Дорожные инструменты можно скрыть; это не удаляет данные." />
    <Text style={shared.sectionTitle}>{project?.name ?? 'Сначала создайте или выберите проект'}</Text>
    <Card><Text style={shared.sectionTitle}>Загрузить свои данные</Text>
      <Button label="Чертёж DXF и слои" disabled={!project} onPress={()=>router.push('/basemap')} />
      <Button style={{marginTop:12}} label="Каталог точек TXT / LandXML" disabled={!project} onPress={()=>router.push('/known')} />
      <Button style={{marginTop:12}} label="Импорт копии GeoField" onPress={()=>router.push('/backup')} />
    </Card>
    <Card><Text style={shared.sectionTitle}>Настроить под объект</Text>
      <View style={shared.row}><Text style={[shared.muted,{flex:1}]}>Дорожные инструменты</Text><Switch disabled={!ready} value={road} onValueChange={async v=>{if(project){await kvSet(`roadTools:${project.id}`,v?'1':'0');setRoad(v);}}} /></View>
      <Text style={shared.muted}>Для здания, площадки или сетей можно скрыть раздел «Дорога». Съёмка, вынос точек, площади и объёмы остаются доступны.</Text>
      <Button style={{marginTop:12}} label="Свои коды объектов" onPress={()=>router.push('/codes')} />
      <Button style={{marginTop:12}} label="Калибровка по реперам" disabled={!project} onPress={()=>router.push('/calibration')} />
    </Card>
  </ScrollView>;
}
