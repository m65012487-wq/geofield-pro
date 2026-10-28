/**
 * Тема GeoField Pro.
 * Полевые условия: яркое солнце, работа в перчатках.
 * Решения: тёмный фон + высокая контрастность, акцент high-visibility,
 * крупные сенсорные цели (минимум 56px), читаемые шрифты.
 */

export const colors = {
  // Поверхности (тёмная схема для контраста на солнце)
  bg: '#0A0E14',
  surface: '#141A24',
  surfaceRaised: '#1C2430',
  surfaceHover: '#242E3C',

  // Границы
  border: '#2A3342',
  borderStrong: '#3A4658',

  // Текст
  textPrimary: '#F2F5F8',
  textSecondary: '#A9B4C2',
  textMuted: '#6B7686',

  // Акцент — high-visibility, читается на солнце
  accent: '#B6F94B',
  accentDim: '#8FD22E',
  accentText: '#0A0E14',
  accentBg: '#1E2A12',

  // Статусы качества GNSS-решения
  fix: '#3DDC84',      // зелёный — RTK Fixed (см. точность)
  float: '#FFB627',    // янтарь — Float
  single: '#FF6B5C',   // красный — Autonomous/Single
  noFix: '#6B7686',    // серый — нет сигнала

  // Семантика
  danger: '#FF5A4D',
  dangerBg: '#2A1411',
  success: '#3DDC84',
  warning: '#FFB627',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  // Размеры
  caption: 12,
  small: 13,
  body: 15,
  bodyLg: 17,
  title: 20,
  display: 28,
  mega: 40,
  // Моноширинный для координат
  mono: 'Menlo',
} as const;

// Минимальный размер сенсорной цели для работы в перчатках
export const TOUCH_TARGET = 56;
