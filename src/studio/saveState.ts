// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/saveState.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * saveState — the editor's autosave state machine (part 07 save safety).
 *
 * Pure TypeScript, no React: the editor wires it around the debounced autosave
 * and renders the header indicator from its snapshot (via useSyncExternalStore
 * — snapshots are immutable and replaced only on change). ADR ws/0001 item 4:
 * retry with capped exponential backoff, an always-visible indicator, and a
 * beforeunload guard whenever the machine is not in 'saved'.
 *
 * States
 * - saved     — the document on the server matches the last edit
 * - saving    — an edit is debouncing or a PUT is in flight (work is NOT safe)
 * - retrying  — a retryable failure (network / 5xx); a backoff timer will call
 *               `onRetry` to re-attempt the save
 * - offline   — navigator reports no network; the 'online' event triggers the
 *               retry instead of a timer
 * - conflict  — the server answered 409 (another tab/device saved first); all
 *               autosaving is blocked until the conflict dialog resolves
 * - failed    — a non-retryable failure (4xx other than 409); no auto-retry,
 *               the next edit re-enters the pipeline
 */

export type SaveState = 'saved' | 'saving' | 'retrying' | 'offline' | 'conflict' | 'failed';

export type SaveStateEvent =
  /** The document changed (store went dirty). Resets the backoff. */
  | { type: 'edit' }
  /** The PUT actually left (debounce fired). */
  | { type: 'saveStart' }
  /** The PUT succeeded. */
  | { type: 'saveOk' }
  /** Retryable failure: fetch threw (network) or the server 5xx'd. */
  | { type: 'saveNetworkError' }
  /** Non-retryable failure: 4xx other than 409. */
  | { type: 'saveHardError' }
  /** The server rejected the save with 409 (stale revision). */
  | { type: 'save409' }
  /** The conflict dialog resolved (reload or take-over completed). */
  | { type: 'conflictResolved' }
  /** Browser connectivity changes ('online'/'offline' window events). */
  | { type: 'online' }
  | { type: 'offline' };

export interface SaveStateSnapshot {
  state: SaveState;
  /** Consecutive failed attempts since the last success/edit. */
  attempt: number;
  /** Delay of the currently scheduled retry, or null when none is scheduled. */
  nextRetryDelayMs: number | null;
}

export interface SaveStateMachineOptions {
  /** Re-attempt the save (fired by the backoff timer or on reconnect). */
  onRetry: () => void;
  /** Injectable for tests; defaults to navigator.onLine (true outside browsers). */
  isOnline?: () => boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface SaveStateMachine {
  getSnapshot: () => SaveStateSnapshot;
  subscribe: (listener: () => void) => () => void;
  dispatch: (event: SaveStateEvent) => void;
  /** Cancel any pending retry timer. The machine must not fire after this. */
  dispose: () => void;
}

export const SAVE_RETRY_BASE_MS = 1200;
export const SAVE_RETRY_MAX_MS = 30_000;

/**
 * Backoff schedule: 1.2s, 2.4s, 4.8s … capped at ~30s. `attempt` is 1-based
 * (the first failure schedules the base delay).
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number = SAVE_RETRY_BASE_MS,
  maxMs: number = SAVE_RETRY_MAX_MS,
): number {
  const exp = Math.max(0, attempt - 1);
  // Guard 2**exp against overflow for absurd attempt counts.
  if (exp > 30) return maxMs;
  return Math.min(baseMs * 2 ** exp, maxMs);
}

const defaultIsOnline = () =>
  typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine;

export function createSaveStateMachine(opts: SaveStateMachineOptions): SaveStateMachine {
  const isOnline = opts.isOnline ?? defaultIsOnline;
  const baseMs = opts.baseDelayMs ?? SAVE_RETRY_BASE_MS;
  const maxMs = opts.maxDelayMs ?? SAVE_RETRY_MAX_MS;

  let snapshot: SaveStateSnapshot = { state: 'saved', attempt: 0, nextRetryDelayMs: null };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const emit = (next: Partial<SaveStateSnapshot>) => {
    const merged = { ...snapshot, ...next };
    if (
      merged.state === snapshot.state &&
      merged.attempt === snapshot.attempt &&
      merged.nextRetryDelayMs === snapshot.nextRetryDelayMs
    ) {
      return;
    }
    snapshot = merged;
    listeners.forEach((l) => l());
  };

  const scheduleRetry = (delayMs: number) => {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      // The retry re-runs the save; its outcome comes back as saveStart/
      // saveOk/… events. Clear the "scheduled" marker first.
      emit({ nextRetryDelayMs: null });
      opts.onRetry();
    }, delayMs);
    emit({ state: 'retrying', nextRetryDelayMs: delayMs });
  };

  const dispatch = (event: SaveStateEvent) => {
    if (disposed) return;
    const s = snapshot.state;
    switch (event.type) {
      case 'edit':
        // New work supersedes any scheduled retry (the debounced autosave is
        // about to run anyway) and resets the backoff.
        cancelTimer();
        if (s === 'conflict') return; // dialog open: autosave stays blocked
        emit({ state: isOnline() ? 'saving' : 'offline', attempt: 0, nextRetryDelayMs: null });
        return;
      case 'saveStart':
        if (s === 'conflict') return;
        cancelTimer();
        emit({ state: 'saving', nextRetryDelayMs: null });
        return;
      case 'saveOk':
        cancelTimer();
        emit({ state: 'saved', attempt: 0, nextRetryDelayMs: null });
        return;
      case 'saveNetworkError': {
        if (s === 'conflict') return;
        if (!isOnline()) {
          // No timer while offline — the 'online' event is the retry trigger.
          cancelTimer();
          emit({ state: 'offline', attempt: snapshot.attempt + 1, nextRetryDelayMs: null });
          return;
        }
        const attempt = snapshot.attempt + 1;
        emit({ attempt });
        scheduleRetry(backoffDelayMs(attempt, baseMs, maxMs));
        return;
      }
      case 'saveHardError':
        if (s === 'conflict') return;
        cancelTimer();
        emit({ state: 'failed', nextRetryDelayMs: null });
        return;
      case 'save409':
        cancelTimer();
        emit({ state: 'conflict', nextRetryDelayMs: null });
        return;
      case 'conflictResolved':
        if (s !== 'conflict') return;
        // Both resolutions leave the local doc aligned with the server:
        // "reload" replaced it; "take over" is immediately followed by a
        // saveStart from the forced re-save.
        emit({ state: 'saved', attempt: 0, nextRetryDelayMs: null });
        return;
      case 'offline':
        if (s === 'saved' || s === 'conflict') return; // nothing pending
        cancelTimer();
        emit({ state: 'offline', nextRetryDelayMs: null });
        return;
      case 'online':
        if (s !== 'offline') return;
        // Back online with unsaved work: retry immediately (still async so
        // the browser settles the connection first).
        scheduleRetry(0);
        return;
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    dispose: () => {
      disposed = true;
      cancelTimer();
      listeners.clear();
    },
  };
}
