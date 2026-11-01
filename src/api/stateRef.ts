import type { RootState } from '@/state/store';

/**
 * Lets `buildHeaders()` (also used by uploads/SSE/downloads outside RTK Query) read the
 * session slice without importing the store (which imports the api). store.ts registers it.
 */
let getter: (() => RootState) | null = null;

export function registerStateGetter(fn: () => RootState): void {
  getter = fn;
}

export function getAppState(): RootState | null {
  return getter ? getter() : null;
}
