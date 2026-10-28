import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { kvGet, kvSet, getProject } from '../db/database';
import type { Project } from '../db/types';

/** Активный проект (модель LandStar: все вкладки работают с текущим проектом). */
export function useActiveProject() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const id = await kvGet('activeProjectId');
      setProject(id ? await getProject(id) : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return { project, loading, reload };
}

export async function setActiveProject(id: string): Promise<void> {
  await kvSet('activeProjectId', id);
}
