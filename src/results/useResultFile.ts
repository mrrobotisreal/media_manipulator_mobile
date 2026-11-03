import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { File } from 'expo-file-system';
import { fetchResultFile, realFetchDeps, ResultGoneError } from './fetchResult';

export type ResultFileState =
  | { status: 'loading'; progress: number }
  | { status: 'ready'; file: File }
  | { status: 'gone' }
  | { status: 'error' };

/**
 * Downloads (or reuses) the result file for a job while mounted; `reload` retries after an error.
 * A download that fails while the app is in the background (Android aborts its sockets: "Software caused
 * connection abort", seen on the S25 with a 30 MB upscale) is retried once the app is active again instead of
 * leaving "Could not load the result" on screen.
 */
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
        if (
          !(e instanceof ResultGoneError) &&
          (failedInBackground || AppState.currentState !== 'active')
        ) {
          resumeOnActive = true;
          return;
        }
        setState(e instanceof ResultGoneError ? { status: 'gone' } : { status: 'error' });
      });
    // Set when the app left the foreground during this download; a failure after that waits for `active`.
    let failedInBackground = false;
    let resumeOnActive = false;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        failedInBackground = true;
        return;
      }
      if (resumeOnActive && live) setAttempt((n) => n + 1);
    });
    return () => {
      live = false;
      sub.remove();
      abort.abort();
    };
  }, [jobId, fileName, sizeBytes, enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
