/**
 * The remembered Projects filter chip (ticket MA58 decision 1): MMKV key `projectsFilter` on the
 * app instance (via `mmkvStorage`, the only MMKV import). Default `all`; an unknown stored value is
 * `all`. Kept out of the `settings` slice on purpose: it is a list preference, not a setting.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Storage } from 'redux-persist';
import { mmkvStorage } from '@/state/persist';
import { isProjectsFilter, type ProjectsFilter } from './merge';

export const PROJECTS_FILTER_KEY = 'projectsFilter';

type Kv = Pick<Storage, 'getItem' | 'setItem'>;

export async function loadProjectsFilter(kv: Kv = mmkvStorage): Promise<ProjectsFilter> {
  try {
    const v: unknown = await kv.getItem(PROJECTS_FILTER_KEY);
    return isProjectsFilter(v) ? v : 'all';
  } catch {
    return 'all';
  }
}

export async function saveProjectsFilter(f: ProjectsFilter, kv: Kv = mmkvStorage): Promise<void> {
  try {
    await kv.setItem(PROJECTS_FILTER_KEY, f);
  } catch {
    // a preference; never worth an error
  }
}

/** `[filter, setFilter]`, starting at `all` until the stored value is read. */
export function useProjectsFilter(): [ProjectsFilter, (f: ProjectsFilter) => void] {
  const [filter, setFilterState] = useState<ProjectsFilter>('all');
  useEffect(() => {
    let live = true;
    void loadProjectsFilter().then((f) => live && setFilterState(f));
    return () => {
      live = false;
    };
  }, []);
  const setFilter = useCallback((f: ProjectsFilter) => {
    setFilterState(f);
    void saveProjectsFilter(f);
  }, []);
  return [filter, setFilter];
}
