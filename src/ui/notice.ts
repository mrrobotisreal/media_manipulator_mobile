import { useSyncExternalStore } from 'react';

/** A one-line, auto-dismissing message (the "toast" of MA14's save/share/delete flows). */
export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

export const NOTICE_MS = 4000;

let current: Notice | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function showNotice(text: string, tone: Notice['tone'] = 'info'): void {
  if (timer) clearTimeout(timer);
  seq += 1;
  current = { id: seq, text, tone };
  emit();
  timer = setTimeout(dismissNotice, NOTICE_MS);
  (timer as { unref?: () => void }).unref?.();
}

export function dismissNotice(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  current = null;
  emit();
}

export function useNotice(): Notice | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
