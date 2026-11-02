import { useCallback } from 'react';
import { track } from '@/analytics/track';

/**
 * Returns `set(key, next)` that updates a flat form object and fires `options_changed {option}`.
 * Keys only, never user values beyond the option's own enum/number (catalog: option, value).
 */
export function useTrackOption<F extends object>(value: F, onChange: (next: F) => void) {
  return useCallback(
    <K extends keyof F & string>(key: K, next: F[K], option: string = key) => {
      onChange({ ...value, [key]: next });
      const v =
        typeof next === 'string' || typeof next === 'number' || typeof next === 'boolean'
          ? next
          : undefined;
      track('options_changed', { option, value: v });
    },
    [value, onChange],
  );
}
