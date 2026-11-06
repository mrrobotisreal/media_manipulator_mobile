import { useSyncExternalStore } from 'react';
import { EVENTS, type AssistantEntryProp } from '@/analytics/events';
import { track } from '@/analytics/track';

/**
 * Where the Medi sheet is open and why. A tiny external store (like `ui/notice.ts`) so the Tools-tab
 * header button, the empty-search row and the one `MediHost` in the app layout share it without a
 * provider. `prefill` is the search text carried into the composer; `nonce` re-applies a prefill when
 * the sheet is already open.
 */
export interface MediUiState {
  open: boolean;
  entry: AssistantEntryProp;
  prefill: string;
  nonce: number;
}

let state: MediUiState = { open: false, entry: 'button', prefill: '', nonce: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getMediUi(): MediUiState {
  return state;
}

/** Opens the sheet and reports `assistant_opened` once per closed-to-open transition. */
export function openMedi(entry: AssistantEntryProp, prefill = ''): void {
  if (!state.open) track(EVENTS.ASSISTANT_OPENED, { surface: 'guide', entry });
  state = { open: true, entry, prefill, nonce: state.nonce + 1 };
  emit();
}

export function closeMedi(): void {
  if (!state.open) return;
  state = { ...state, open: false, prefill: '' };
  emit();
}

export function resetMediUiForTests(): void {
  state = { open: false, entry: 'button', prefill: '', nonce: 0 };
  emit();
}

export function useMediUi(): MediUiState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getMediUi,
    getMediUi,
  );
}
