import { track } from '@/analytics/track';

/** Form keys that a dedicated control reports itself (the scrubber emits `option: 'trim'` per gesture). */
const SELF_REPORTED = new Set(['start', 'end']);

export const OPTIONS_DEBOUNCE_MS = 500;

/**
 * Debounced `options_changed {option}` (keys only, never values): collects the changed form keys and
 * emits one event per key after the user pauses. Returns `{ note(prev, next), flush() }`.
 */
export function createOptionsChangedReporter(delay = OPTIONS_DEBOUNCE_MS) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    for (const option of pending) track('options_changed', { option });
    pending.clear();
  };
  return {
    note(prev: object, next: object) {
      const a = prev as Record<string, unknown>;
      const b = next as Record<string, unknown>;
      for (const k of Object.keys(b)) {
        if (SELF_REPORTED.has(k)) continue;
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) pending.add(k);
      }
      if (pending.size === 0) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
  };
}
