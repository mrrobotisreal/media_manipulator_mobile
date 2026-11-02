import { useCallback, useEffect, useRef, useState } from 'react';
import { inspectFile, type InspectDeps } from '@/api/endpoints/metadata';
import type { MmError } from '@/api/errors';
import type { ToolInputInfo } from '@/tools/types';
import type { MetadataDocument } from './types';

/** Documents already fetched this app session, by intake id: Strip/Edit reuse Inspect's call. */
const cache = new Map<string, MetadataDocument>();

export function resetInspectCacheForTests(): void {
  cache.clear();
}

let deps: InspectDeps | null = null;

/** Tests inject a fake upload task; production builds the real `expo-file-system` one lazily. */
export function setInspectDeps(next: InspectDeps | null): void {
  deps = next;
}

function realDeps(): InspectDeps {
  if (deps) return deps;
  // Lazy: keeps expo-file-system out of unit tests that never inspect.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { makeUploadTask } = require('@/jobs/fsTask') as typeof import('@/jobs/fsTask');
  return { makeTask: makeUploadTask };
}

export type InspectState =
  | { status: 'idle' }
  | { status: 'loading'; progress: number }
  | { status: 'ready'; document: MetadataDocument }
  | { status: 'error'; error: MmError };

const keyOf = (input: ToolInputInfo) => input.id ?? input.uri ?? input.name;

/**
 * Auto-inspects the picked file (sync `POST /metadata/inspect`, never charged). Re-runs when the
 * file changes; `retry` re-runs after an error.
 */
export function useInspect(input: ToolInputInfo | undefined): InspectState & { retry: () => void } {
  const [state, setState] = useState<InspectState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const key = input ? keyOf(input) : null;
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });

  useEffect(() => {
    const file = inputRef.current;
    if (!key || !file?.uri) return;
    const controller = new AbortController();
    const hit = cache.get(key);
    if (hit) {
      queueMicrotask(
        () => !controller.signal.aborted && setState({ status: 'ready', document: hit }),
      );
      return () => controller.abort();
    }
    queueMicrotask(
      () => !controller.signal.aborted && setState({ status: 'loading', progress: 0 }),
    );
    void inspectFile(
      { fileUri: file.uri, mimeType: file.mime || 'application/octet-stream' },
      realDeps(),
      controller.signal,
      (progress) => !controller.signal.aborted && setState({ status: 'loading', progress }),
    ).then((res) => {
      if (controller.signal.aborted) return;
      if (res.ok) {
        cache.set(key, res.document);
        setState({ status: 'ready', document: res.document });
      } else setState({ status: 'error', error: res.error });
    });
    return () => controller.abort();
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
