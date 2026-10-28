import { useRef, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync,
  createAudioPlayer, type AudioPlayer,
} from 'expo-audio';
import { updatePoint } from '../db/database';
import type { SurveyPoint } from '../db/types';

/** Фото и голосовые заметки к точкам: файлы в «документах» приложения, путь — в полях photo/voice. */

function mediaDir(): Directory {
  const d = new Directory(Paths.document, 'media');
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

function fileFor(pointId: string, kind: 'photo' | 'voice'): File {
  return new File(mediaDir(), `${pointId}.${kind === 'photo' ? 'jpg' : 'm4a'}`);
}

/** Копирует исходный файл в папку media и пишет путь в точку. Возвращает новый uri. */
async function attach(pointId: string, kind: 'photo' | 'voice', srcUri: string): Promise<string> {
  const dest = fileFor(pointId, kind);
  if (dest.exists) dest.delete();
  new File(srcUri).copy(dest);
  await updatePoint(pointId, kind === 'photo' ? { photo: dest.uri } : { voice: dest.uri });
  return dest.uri;
}

/** Снимает фото камерой и привязывает к точке. null — отменено или нет разрешения. */
export async function takePhoto(pointId: string): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Нет разрешения на камеру');
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
  if (r.canceled || !r.assets?.[0]) return null;
  return attach(pointId, 'photo', r.assets[0].uri);
}

/** Удаляет файл заметки и очищает поле точки. */
export async function removeMedia(p: Pick<SurveyPoint, 'id' | 'photo' | 'voice'>, kind: 'photo' | 'voice'): Promise<void> {
  const uri = kind === 'photo' ? p.photo : p.voice;
  if (uri) { try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* уже нет */ } }
  await updatePoint(p.id, kind === 'photo' ? { photo: '' } : { voice: '' });
}

/** Файлы удалённой точки (саму запись из БД удаляет вызывающий). */
export function deletePointFiles(p: Pick<SurveyPoint, 'photo' | 'voice'>): void {
  for (const uri of [p.photo, p.voice]) {
    if (!uri) continue;
    try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* уже нет */ }
  }
}

/** Запись голоса: toggle() — начать, ещё раз — остановить и сохранить в точку. */
export function useVoiceRecorder(onSaved: () => void) {
  const rec = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recId, setRecId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);

  const toggle = async (pointId: string) => {
    if (idRef.current) {
      const id = idRef.current;
      idRef.current = null; setRecId(null);
      try {
        await rec.stop();
        const uri = rec.uri;
        if (uri) await attach(id, 'voice', uri);
      } finally {
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
      }
      onSaved();
      return;
    }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) throw new Error('Нет разрешения на микрофон');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await rec.prepareToRecordAsync();
    rec.record();
    idRef.current = pointId; setRecId(pointId);
  };
  return { recId, toggle };
}

let current: AudioPlayer | null = null;

/** Проигрывает голосовую заметку; прежнюю останавливает. */
export function playVoice(uri: string): void {
  stopVoice();
  try {
    current = createAudioPlayer(uri);
    current.play();
  } catch { current = null; }
}

export function stopVoice(): void {
  if (!current) return;
  try { current.pause(); current.remove(); } catch { /* уже освобождён */ }
  current = null;
}
