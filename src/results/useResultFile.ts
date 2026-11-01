import { useCallback, useEffect, useRef, useState } from 'react';
import type { File } from 'expo-file-system';
import { fetchResultFile, realFetchDeps, ResultGoneError } from './fetchResult';

export type ResultFileState =
  | { status: 'loading'; progress: number }
  | { status: 'ready'; file: File }
  | { status: 'gone' }
  | { status: 'error' };

/** Downloads (or reuses) the result file for a job while mounted; `reload` retries after an error. */
export function useResultFile(
  jobId: string | undefined,
  fileName: string,
  sizeBytes?: number,
  enabled = true,
): { state: ResultFileState; reload: () => void } {
  const [state, setState] = useState<ResultFileState>({ status: 'loading', progress: 0 });
  const [attempt, setAttempt] = useState(0);
  const lastProgress = useRef(0);

  useEffect(() => {
    if (!jobId || !enabled) return;
    const abort = new AbortController();
    let live = true;
    lastProgress.current = 0;
    // Reset for a new job/retry before the async work starts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: 'loading', progress: 0 });
    fetchResultFile(
      {
        jobId,
        fileName,
        sizeBytes,
        signal: abort.signal,
        onProgress: (f) => {
          // Throttle re-renders to 2 % steps.
          if (!live || f - lastProgress.current < 0.02) return;
          lastProgress.current = f;
          setState({ status: 'loading', progress: f });
        },
      },
      realFetchDeps(),
    )
      .then((file) => live && setState({ status: 'ready', file }))
      .catch((e) => {
        if (!live) return;
        setState(e instanceof ResultGoneError ? { status: 'gone' } : { status: 'error' });
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [jobId, fileName, sizeBytes, enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
