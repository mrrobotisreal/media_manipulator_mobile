// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/saveState.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  backoffDelayMs,
  createSaveStateMachine,
  SAVE_RETRY_BASE_MS,
  SAVE_RETRY_MAX_MS,
  type SaveStateMachine,
} from './saveState';

describe('backoffDelayMs', () => {
  it('doubles from the 1.2s base and caps at ~30s', () => {
    expect(backoffDelayMs(1)).toBe(1200);
    expect(backoffDelayMs(2)).toBe(2400);
    expect(backoffDelayMs(3)).toBe(4800);
    expect(backoffDelayMs(4)).toBe(9600);
    expect(backoffDelayMs(5)).toBe(19200);
    expect(backoffDelayMs(6)).toBe(SAVE_RETRY_MAX_MS);
    expect(backoffDelayMs(50)).toBe(SAVE_RETRY_MAX_MS);
  });

  it('treats attempt<=1 as the base delay', () => {
    expect(backoffDelayMs(0)).toBe(SAVE_RETRY_BASE_MS);
    expect(backoffDelayMs(-3)).toBe(SAVE_RETRY_BASE_MS);
  });
});

describe('createSaveStateMachine', () => {
  let onRetry: ReturnType<typeof vi.fn<() => void>>;
  let online: boolean;
  let machine: SaveStateMachine;

  beforeEach(() => {
    vi.useFakeTimers();
    onRetry = vi.fn<() => void>();
    online = true;
    machine = createSaveStateMachine({ onRetry, isOnline: () => online });
  });

  afterEach(() => {
    machine.dispose();
    vi.useRealTimers();
  });

  const state = () => machine.getSnapshot().state;

  it('starts saved', () => {
    expect(state()).toBe('saved');
  });

  it('walks the happy path: edit → saveStart → saveOk', () => {
    machine.dispatch({ type: 'edit' });
    expect(state()).toBe('saving'); // debouncing counts as unsafe
    machine.dispatch({ type: 'saveStart' });
    expect(state()).toBe('saving');
    machine.dispatch({ type: 'saveOk' });
    expect(state()).toBe('saved');
  });

  it('notifies subscribers on transitions with immutable snapshots', () => {
    const listener = vi.fn();
    machine.subscribe(listener);
    const before = machine.getSnapshot();
    machine.dispatch({ type: 'edit' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(machine.getSnapshot()).not.toBe(before);
    // No-op event → no notification, same snapshot reference.
    const mid = machine.getSnapshot();
    machine.dispatch({ type: 'saveStart' });
    expect(machine.getSnapshot()).toBe(mid);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  describe('retry with backoff', () => {
    it('schedules onRetry at 1.2s after the first network error', () => {
      machine.dispatch({ type: 'saveStart' });
      machine.dispatch({ type: 'saveNetworkError' });
      expect(state()).toBe('retrying');
      expect(machine.getSnapshot().nextRetryDelayMs).toBe(1200);

      vi.advanceTimersByTime(1199);
      expect(onRetry).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('doubles the delay on consecutive failures up to the cap', () => {
      const delays: number[] = [];
      for (let i = 0; i < 7; i++) {
        machine.dispatch({ type: 'saveNetworkError' });
        delays.push(machine.getSnapshot().nextRetryDelayMs!);
        vi.runOnlyPendingTimers(); // fire the retry; simulate it failing again
      }
      expect(delays).toEqual([1200, 2400, 4800, 9600, 19200, 30000, 30000]);
      expect(onRetry).toHaveBeenCalledTimes(7);
    });

    it('resets the backoff on success', () => {
      machine.dispatch({ type: 'saveNetworkError' });
      machine.dispatch({ type: 'saveNetworkError' });
      expect(machine.getSnapshot().attempt).toBe(2);
      machine.dispatch({ type: 'saveOk' });
      expect(machine.getSnapshot().attempt).toBe(0);
      machine.dispatch({ type: 'saveNetworkError' });
      expect(machine.getSnapshot().nextRetryDelayMs).toBe(1200);
    });

    it('resets the backoff and cancels the pending retry on edit', () => {
      machine.dispatch({ type: 'saveNetworkError' });
      machine.dispatch({ type: 'saveNetworkError' });
      machine.dispatch({ type: 'edit' });
      expect(state()).toBe('saving');
      expect(machine.getSnapshot().attempt).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(onRetry).not.toHaveBeenCalled(); // edit superseded the timer
    });

    it('never fires after dispose', () => {
      machine.dispatch({ type: 'saveNetworkError' });
      machine.dispose();
      vi.advanceTimersByTime(60_000);
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe('offline', () => {
    it('goes offline instead of arming a timer when the network is down', () => {
      online = false;
      machine.dispatch({ type: 'saveStart' });
      machine.dispatch({ type: 'saveNetworkError' });
      expect(state()).toBe('offline');
      vi.advanceTimersByTime(60_000);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('edits made while offline keep the offline state', () => {
      online = false;
      machine.dispatch({ type: 'saveNetworkError' });
      machine.dispatch({ type: 'edit' });
      expect(state()).toBe('offline');
    });

    it('moves pending work offline on the offline event, but not a saved doc', () => {
      machine.dispatch({ type: 'offline' });
      expect(state()).toBe('saved'); // nothing pending → nothing to warn about

      machine.dispatch({ type: 'edit' });
      machine.dispatch({ type: 'offline' });
      expect(state()).toBe('offline');
    });

    it('retries immediately when connectivity returns', () => {
      machine.dispatch({ type: 'edit' });
      machine.dispatch({ type: 'offline' });
      online = true;
      machine.dispatch({ type: 'online' });
      expect(state()).toBe('retrying');
      vi.advanceTimersByTime(0);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('ignores the online event when nothing was pending', () => {
      machine.dispatch({ type: 'online' });
      expect(state()).toBe('saved');
      vi.advanceTimersByTime(1000);
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe('409 conflict', () => {
    it('enters conflict and cancels any scheduled retry', () => {
      machine.dispatch({ type: 'saveNetworkError' });
      machine.dispatch({ type: 'save409' });
      expect(state()).toBe('conflict');
      vi.advanceTimersByTime(60_000);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('blocks every autosave event while the dialog is open', () => {
      machine.dispatch({ type: 'save409' });
      machine.dispatch({ type: 'edit' });
      machine.dispatch({ type: 'saveStart' });
      machine.dispatch({ type: 'saveNetworkError' });
      machine.dispatch({ type: 'saveHardError' });
      expect(state()).toBe('conflict');
      vi.advanceTimersByTime(60_000);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('returns to saved once the conflict resolves', () => {
      machine.dispatch({ type: 'save409' });
      machine.dispatch({ type: 'conflictResolved' });
      expect(state()).toBe('saved');
      // A take-over re-save then reports normally.
      machine.dispatch({ type: 'saveStart' });
      machine.dispatch({ type: 'saveOk' });
      expect(state()).toBe('saved');
    });

    it('ignores conflictResolved outside a conflict', () => {
      machine.dispatch({ type: 'edit' });
      machine.dispatch({ type: 'conflictResolved' });
      expect(state()).toBe('saving');
    });
  });

  describe('hard failure', () => {
    it('parks in failed with no auto-retry', () => {
      machine.dispatch({ type: 'saveStart' });
      machine.dispatch({ type: 'saveHardError' });
      expect(state()).toBe('failed');
      vi.advanceTimersByTime(60_000);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('recovers on the next edit', () => {
      machine.dispatch({ type: 'saveHardError' });
      machine.dispatch({ type: 'edit' });
      expect(state()).toBe('saving');
    });
  });
});
