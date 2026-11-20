// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/versionCheckpoint.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCheckpointScheduler } from './versionCheckpoint';

// Part 09: the checkpoint-interval gating logic, exercised with fake timers.
// The invariants: exactly one checkpoint on open; one per tick only when the
// document reference changed since the last LANDED checkpoint; one silent
// early retry on failure; dispose stops everything.

const INTERVAL = 1000;
const RETRY = 100;

describe('createCheckpointScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (initialDoc: object | null = { v: 0 }) => {
    let doc = initialDoc;
    const checkpoint = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const scheduler = createCheckpointScheduler({
      getDocument: () => doc,
      checkpoint,
      intervalMs: INTERVAL,
      retryMs: RETRY,
    });
    return { scheduler, checkpoint, setDoc: (d: object | null) => (doc = d) };
  };

  it('checkpoints once on start (editor open)', async () => {
    const { scheduler, checkpoint } = setup();
    scheduler.start();
    expect(checkpoint).toHaveBeenCalledTimes(1);
    await vi.runOnlyPendingTimersAsync();
    scheduler.dispose();
  });

  it('start is idempotent', () => {
    const { scheduler, checkpoint } = setup();
    scheduler.start();
    scheduler.start();
    expect(checkpoint).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('skips ticks while the document is unchanged, fires again after an edit', async () => {
    const { scheduler, checkpoint, setDoc } = setup({ v: 0 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0); // let the open checkpoint land

    // Two full intervals with no edits → no further checkpoints.
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(checkpoint).toHaveBeenCalledTimes(1);

    // An edit replaces the document reference → next tick checkpoints.
    setDoc({ v: 1 });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(checkpoint).toHaveBeenCalledTimes(2);

    // Landed → baseline advanced → quiet again.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(checkpoint).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('skips ticks while no document is hydrated', async () => {
    const { scheduler, checkpoint, setDoc } = setup(null);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(checkpoint).not.toHaveBeenCalled();

    // Document appears → next tick takes the open checkpoint.
    setDoc({ v: 0 });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('retries once, silently and sooner, after a failure', async () => {
    const { scheduler, checkpoint } = setup({ v: 0 });
    checkpoint.mockResolvedValueOnce(false);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0); // the failed open attempt settles
    expect(checkpoint).toHaveBeenCalledTimes(1);

    // The early retry fires well before the next interval and lands.
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(checkpoint).toHaveBeenCalledTimes(2);

    // Baseline advanced on the retry's success → the interval stays quiet.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(checkpoint).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('a failed retry waits for the next interval (no retry storm)', async () => {
    const { scheduler, checkpoint } = setup({ v: 0 });
    checkpoint.mockResolvedValue(false);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RETRY); // retry #1 — also fails
    expect(checkpoint).toHaveBeenCalledTimes(2);

    // Quiet until the next interval tick — a failed retry never chains.
    await vi.advanceTimersByTimeAsync(RETRY * 3);
    expect(checkpoint).toHaveBeenCalledTimes(2);

    // The tick itself attempts again (#3, fails)…
    await vi.advanceTimersByTimeAsync(INTERVAL - RETRY * 4);
    expect(checkpoint).toHaveBeenCalledTimes(3);
    // …and is allowed its own single early retry (#4), then quiet again.
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(checkpoint).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(RETRY * 3);
    expect(checkpoint).toHaveBeenCalledTimes(4);
    scheduler.dispose();
  });

  it('never overlaps checkpoints while one is in flight', async () => {
    let resolveFirst: (ok: boolean) => void = () => undefined;
    const checkpoint = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValue(true);
    const scheduler = createCheckpointScheduler({
      getDocument: () => ({ v: 0 }),
      checkpoint,
      intervalMs: INTERVAL,
      retryMs: RETRY,
    });
    scheduler.start();
    // Ticks pass while the open checkpoint is still in flight → no new calls.
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    resolveFirst(true);
    scheduler.dispose();
  });

  it('dispose stops the interval and pending retry', async () => {
    const { scheduler, checkpoint, setDoc } = setup({ v: 0 });
    checkpoint.mockResolvedValueOnce(false);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0); // failure schedules a retry
    scheduler.dispose();
    setDoc({ v: 1 });
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(checkpoint).toHaveBeenCalledTimes(1);
  });
});
