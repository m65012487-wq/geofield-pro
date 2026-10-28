import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/**
 * Звук и голос при съёмке, чтобы не смотреть на экран: короткий сигнал на старте,
 * двойной — точка записана, низкий — ошибка; голосом имя точки и следующий объект.
 */
type Kind = 'start' | 'done' | 'bad';

const SOURCES: Record<Kind, number> = {
  start: require('../../assets/beep_start.wav'),
  done: require('../../assets/beep_done.wav'),
  bad: require('../../assets/beep_bad.wav'),
};

let players: Partial<Record<Kind, AudioPlayer>> = {};
let ready = false;

function player(kind: Kind): AudioPlayer | null {
  try {
    if (!ready) {
      ready = true;
      // на iPhone сигнал слышен и при выключенном звонке; чужую музыку не останавливаем
      setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
    }
    return (players[kind] ??= createAudioPlayer(SOURCES[kind]));
  } catch {
    return null;
  }
}

export function beep(kind: Kind) {
  const p = player(kind);
  if (p) {
    try { p.seekTo(0).then(() => p.play()).catch(() => p.play()); } catch { /* без звука */ }
  }
  if (kind === 'bad') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  else if (kind === 'done') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function say(text: string) {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'ru-RU', rate: 1.1 });
  } catch { /* нет синтезатора — молча */ }
}

/** «DOR15» → «Дорога 15»: латинский код синтезатор читает по буквам, описание — по-русски. */
export function spokenName(name: string, code: string, description?: string) {
  const num = name.startsWith(code) ? name.slice(code.length) : name;
  return `${description || code} ${num}`.trim();
}
