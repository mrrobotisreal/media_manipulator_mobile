import { useEffect } from 'react';
import { useAppSelector } from '@/state/hooks';
import { findJob } from '@/state/slices/jobs';
import { getJobEngine } from './runtime';
import type { JobRecord } from './types';

/** The record for a local (`local_<uuid>`) or server job id, watched with SSE while mounted. */
export function useJob(id: string | undefined): JobRecord | undefined {
  const record = useAppSelector((s) => findJob(s.jobs, id));
  const localId = record?.localId;
  useEffect(() => {
    if (!localId) return;
    const engine = getJobEngine();
    engine.watch(localId);
    return () => engine.unwatch(localId);
  }, [localId]);
  return record;
}

/** 1-based position of a record among the jobs started together, for the "1 of N" strip. */
export function useBatchPosition(record: JobRecord | undefined): { index: number; count: number } {
  return useAppSelector((s) => {
    if (!record?.batchId) return { index: 1, count: 1 };
    const siblings = s.jobs.order
      .map((id) => s.jobs.byLocalId[id])
      .filter((r): r is JobRecord => r?.batchId === record.batchId)
      .sort((a, b) => a.createdAt - b.createdAt || a.localId.localeCompare(b.localId));
    return {
      index: siblings.findIndex((r) => r.localId === record.localId) + 1,
      count: siblings.length,
    };
  });
}
