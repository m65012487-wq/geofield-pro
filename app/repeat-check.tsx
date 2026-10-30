import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, Alert, TextInput } from 'react-native';
import { shared } from '../src/theme/shared';
import { Button, Card, QualityBadge } from '../src/components/ui';
import { ScreenHelp } from '../src/components/Help';
import { useActiveProject } from '../src/lib/useActiveProject';
import { useGnss } from '../src/lib/useGnss';
import { useCalibration, localOf } from '../src/lib/calibStore';
import { listPoints, kvGet, kvSet } from '../src/db/database';
import type { SurveyPoint, LivePosition } from '../src/db/types';

export default function RepeatCheck() {
  const { project } = useActiveProject();
  const { position } = useGnss();
  const calib = useCalibration(project?.id);
  const [point,setPoint] = useState<SurveyPoint|null>(null);
  const [pole,setPole] = useState<number|null>(null);
  const [running,setRunning] = useState(false);
  const [count,setCount] = useState(0);
  const [planTol,setPlanTol] = useState('0.03');
  const [heightTol,setHeightTol] = useState('0.04');
  const [result,setResult] = useState<{dN:number;dE:number;dH:number;ok:boolean}|null>(null);
  const samples = useRef<LivePosition[]>([]);
  const lastTs = useRef(0);
  const started = useRef(0);
  const context = useRef<{point:SurveyPoint;pole:number;calib:typeof calib;plan:number;height:number;pid:string}|null>(null);
  const parse = (s:string) => Number(s.replace(',','.'));
  useEffect(() => {
    let alive = true;
    setPoint(null); setPole(null); setRunning(false); setResult(null);
    if (project) listPoints(project.id).then(ps => { if(alive) setPoint(ps[0] ?? null); });
    Promise.all([kvGet('antennaHeight'),kvGet('tiltByReceiver')]).then(([h,t]) => {
      const v = t === '1' ? 0 : Number(h ?? '2');
      if(alive && Number.isFinite(v) && v >= 0) setPole(v);
    });
    return () => { alive=false; context.current=null; };
  },[project?.id]);
  useEffect(() => {
    const c = context.current;
    if(!running || !c || !position || position.timestamp <= lastTs.current || position.timestamp < started.current) return;
    lastTs.current=position.timestamp;
    if(position.quality !== 'fix' || ![position.latitude,position.longitude,position.elevation].every(Number.isFinite)) { samples.current=[]; setCount(0); return; }
    samples.current.push(position); setCount(samples.current.length);
    if(samples.current.length < 3) return;
    setRunning(false);
    const mean = (f:(p:LivePosition)=>number) => samples.current.reduce((s,p)=>s+f(p),0)/samples.current.length;
    const a=localOf(c.calib,c.point.latitude,c.point.longitude,c.point.elevation);
    const b=localOf(c.calib,mean(p=>p.latitude),mean(p=>p.longitude),mean(p=>p.elevation)-c.pole);
    if(!a || !b) return;
    const dN=b.north-a.north,dE=b.east-a.east,dH=b.height-a.height;
    const r={dN,dE,dH,ok:Math.hypot(dN,dE)<=c.plan && Math.abs(dH)<=c.height};
    setResult(r);
    const key=`repeatChecks:${c.pid}`;
    (async () => { const raw=await kvGet(key); let history:any[]=[]; try { const v=JSON.parse(raw ?? '[]'); if(Array.isArray(v)) history=v; } catch {} history.push({...r,pointId:c.point.id,name:c.point.name,ts:Date.now(),epochs:3,pole:c.pole,planTolerance:c.plan,heightTolerance:c.height,calibration:c.calib}); await kvSet(key,JSON.stringify(history.slice(-200))); })().catch(() => Alert.alert('Результат рассчитан', 'Не удалось сохранить запись проверки.'));
  },[position,running]);
  const start = () => {
    if(!point || !project || pole == null) return;
    if(!calib?.cal) return Alert.alert('Нужна калибровка', 'Сначала выполните калибровку проекта.');
    const plan=parse(planTol),height=parse(heightTol);
    if(!Number.isFinite(plan)||!Number.isFinite(height)||plan<=0||height<=0) return Alert.alert('Допуски','Введите положительные значения в метрах.');
    context.current={point,pole,calib,plan,height,pid:project.id};
    samples.current=[];lastTs.current=position?.timestamp ?? 0;started.current=Date.now();setResult(null);setCount(0);setRunning(true);
  };
  const mm=(v:number)=>(v*1000).toFixed(0)+' мм';
  return <ScrollView style={shared.container} contentContainerStyle={{padding:16,gap:16}}>
    <ScreenHelp title="Повторный контроль" text="Верните наконечник вехи на последнюю снятую точку. Проверьте высоту вехи и режим компенсации наклона. Собираются три новые эпохи FIX; потеря FIX сбрасывает набор. Сравниваются исходные географические координаты и повторное измерение, приведённые через текущую калибровку. Исходная точка и нумерация не меняются. История сохраняется отдельно в проекте. Это проверка повторяемости, а не независимый контроль точности базы. При 5-секундном потоке потребуется около 15 секунд после появления FIX." />
    <QualityBadge quality={position?.quality ?? 'none'} />
    <Card><Text style={shared.sectionTitle}>{point ? `Проверяем ${point.name}` : 'В проекте пока нет точек'}</Text>
      <Text style={shared.muted}>Верните наконечник на точку. Текущая поправка за веху: {pole == null ? 'загрузка' : pole.toFixed(3)+' м'}.</Text>
      <Text style={shared.label}>Допуск в плане, м</Text><TextInput style={shared.input} value={planTol} onChangeText={setPlanTol} editable={!running} keyboardType="decimal-pad" />
      <Text style={shared.label}>Допуск по высоте, м</Text><TextInput style={shared.input} value={heightTol} onChangeText={setHeightTol} editable={!running} keyboardType="decimal-pad" />
      <Button style={{marginTop:16}} label={running ? `Отмена · ${count}/3 · ${position?.quality === 'fix' ? 'набор эпох' : 'жду FIX'}` : 'Проверить последнюю точку'} disabled={!point || pole == null} onPress={running ? () => {setRunning(false);samples.current=[];} : start} />
    </Card>
    {result && <Card><Text style={shared.sectionTitle}>{result.ok ? 'В заданном допуске' : 'Есть расхождение'}</Text><Text style={shared.muted}>ΔN {mm(result.dN)} · ΔE {mm(result.dE)}{ '\n' }План {mm(Math.hypot(result.dN,result.dE))} · ΔH {mm(result.dH)}{ '\n' }Исходная точка сохранена без изменений.</Text></Card>}
  </ScrollView>;
}
