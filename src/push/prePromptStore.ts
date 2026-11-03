import { useSyncExternalStore } from 'react';

export type PromptSurface = 'long_job' | 'settings';

interface Pending {
  surface: PromptSurface;
  resolve: (accepted: boolean) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows the pre-prompt sheet; resolves true on "Notify me", false on "Not now" or a dismissal. */
export function showPrePrompt(surface: PromptSurface): Promise<boolean> {
  if (pending) pending.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = { surface, resolve };
    emit();
  });
}

export function answerPrePrompt(accepted: boolean): void {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(accepted);
}

export function usePrePromptSurface(): PromptSurface | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => pending?.surface ?? null,
    () => null,
  );
}
