// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/versionCheckpoint.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * versionCheckpoint — the client half of part 09's auto-checkpoint triggers
 * (ADR ws/0001 item 3): one checkpoint on editor open, then one per interval
 * tick *only when the document changed since the last landed checkpoint*.
 * (The "before export" trigger is server-side, in the ExportProject handler.)
 *
 * Pure timer/gating logic with injected callbacks so it is unit-testable with
 * fake timers — no store, no network. Checkpoints are a safety net, never a
 * gate on editing: a failure is swallowed after ONE silent early retry (the
 * next interval tick retries anyway, because the baseline only advances on
 * success).
 *
 * "Changed since last checkpoint" is a reference compare against the document
 * captured when the previous checkpoint landed. The store never mutates the
 * project object in place (every edit and every markSaved replaces it), so
 * identity is a sound cheap dirty flag; the rare false positive (markSaved
 * refreshing metadata) only ever follows a real edit, which deserved a
 * checkpoint anyway.
 */

/** ~5 minutes of active editing between automatic checkpoints. */
export const CHECKPOINT_INTERVAL_MS = 5 * 60_000;
/** Delay before the single silent retry after a failed checkpoint. */
export const CHECKPOINT_RETRY_MS = 30_000;

export interface CheckpointScheduler {
  /** Fire the editor-open checkpoint and start the interval. Idempotent. */
  start: () => void;
  /** Stop all timers; in-flight results are ignored. */
  dispose: () => void;
}

export interface CheckpointSchedulerOptions {
  /** The live document, or null when nothing is hydrated (tick is skipped). */
  getDocument: () => object | null;
  /** POST {kind:'auto'}; resolve true when it landed. Must not throw. */
  checkpoint: () => Promise<boolean>;
  intervalMs?: number;
  retryMs?: number;
}

export function createCheckpointScheduler(opts: CheckpointSchedulerOptions): CheckpointScheduler {
  const intervalMs = opts.intervalMs ?? CHECKPOINT_INTERVAL_MS;
  const retryMs = opts.retryMs ?? CHECKPOINT_RETRY_MS;

  let interval: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Document reference at the last checkpoint that LANDED. */
  let lastCheckpointed: object | null = null;
  let inFlight = false;
  let disposed = false;

  const attempt = (isRetry: boolean) => {
    if (disposed || inFlight) return;
    const doc = opts.getDocument();
    if (doc === null) return;
    // Unchanged since the last landed checkpoint → nothing worth snapshotting.
    // (The very first attempt has a null baseline and always runs — that IS
    // the on-open checkpoint.)
    if (doc === lastCheckpointed) return;
    inFlight = true;
    void opts.checkpoint().then((ok) => {
      inFlight = false;
      if (disposed) return;
      if (ok) {
        // Baseline is the document AS OF the request, so edits made while the
        // POST was in flight still count as "changed" next tick.
        lastCheckpointed = doc;
      } else if (!isRetry && retryTimer === null) {
        // One silent early retry; beyond that the interval itself retries.
        retryTimer = setTimeout(() => {
          retryTimer = null;
          attempt(true);
        }, retryMs);
      }
    });
  };

  return {
    start: () => {
      if (disposed || interval !== null) return;
      attempt(false);
      interval = setInterval(() => attempt(false), intervalMs);
    },
    dispose: () => {
      disposed = true;
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    },
  };
}
