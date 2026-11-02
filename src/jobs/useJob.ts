import { useEffect, useMemo } from 'react';
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
  // Select primitives (a fresh object per call re-renders on every store change), then pair them.
  const position = useAppSelector((s) => batchPosition(s.jobs.order, s.jobs.byLocalId, record));
  const [index = 1, count = 1] = position.split('/').map(Number);
  return useMemo(() => ({ index, count }), [index, count]);
}

function batchPosition(
  order: string[],
  byLocalId: Record<string, JobRecord | undefined>,
  record: JobRecord | undefined,
): string {
  if (!record?.batchId) return '1/1';
  const siblings = order
    .map((id) => byLocalId[id])
    .filter((r): r is JobRecord => r?.batchId === record.batchId)
    .sort((a, b) => a.createdAt - b.createdAt || a.localId.localeCompare(b.localId));
  return `${siblings.findIndex((r) => r.localId === record.localId) + 1}/${siblings.length}`;
}
