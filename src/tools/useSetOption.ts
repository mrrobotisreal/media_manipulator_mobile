import { useCallback } from 'react';

/** `set(key, next)` updates one key of a flat form object; the tool route emits `options_changed`. */
export function useSetOption<F extends object>(value: F, onChange: (next: F) => void) {
  return useCallback(
    <K extends keyof F & string>(key: K, next: F[K], _option?: string) => {
      onChange({ ...value, [key]: next });
    },
    [value, onChange],
  );
}
