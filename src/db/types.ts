/** Типы качества GNSS-решения (как в реальных RTK-приёмниках). */
export type FixQuality = 'fix' | 'float' | 'single' | 'none';

export interface Project {
  id: string;
  name: string;
  description: string;
  crs: string;
  createdAt: number;
  updatedAt: number;
  pointCount?: number;
}

export interface SurveyPoint {
  id: string;
  projectId: string;
  name: string;
  code: string;
  latitude: number;
  longitude: number;
  elevation: number;
  quality: FixQuality;
  hAccuracy: number;
  vAccuracy: number;
  /** Кол-во усреднённых эпох. */
  epochs: number;
  note: string;
  createdAt: number;
}

/** Вершина линии/полигона. */
export interface Vertex {
  lat: number;
  lon: number;
  elev: number;
}

/** Линейный или полигональный объект. */
export interface Feature {
  id: string;
  projectId: string;
  type: 'line' | 'polygon';
  name: string;
  code: string;
  /** Вершины (JSON в БД). */
  vertices: Vertex[];
  createdAt: number;
}

/** Код объекта из библиотеки. */
export interface FeatureCode {
  id: string;
  code: string;
  description: string;
  color: string;
}

/** Живые данные позиции от GPS-модуля телефона. */
export interface LivePosition {
  latitude: number;
  longitude: number;
  elevation: number;
  hAccuracy: number;
  vAccuracy: number;
  quality: FixQuality;
  satellites: number | null;
  timestamp: number;
}
