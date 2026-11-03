import type { PermissionState } from './permission';
import type { PromptSurface } from './prePromptStore';

/** A job still running this long after `job_started` (server acceptance) counts as a "long job". */
export const LONG_JOB_MS = 20_000;
/** After "Not now" or an OS denial the automatic ask stays quiet this long (**proposed**). */
export const REASK_MS = 30 * 24 * 60 * 60 * 1000;

export function shouldAutoPrompt(i: {
  permission: PermissionState;
  dismissedAt: number | null | undefined;
  now: number;
}): boolean {
  if (i.permission !== 'undetermined') return false;
  return i.dismissedAt == null || i.now - i.dismissedAt >= REASK_MS;
}

export interface TimedJob {
  state: string;
  acceptedAt?: number;
}

const isRunning = (j: TimedJob) =>
  (j.state === 'pending' || j.state === 'processing') && j.acceptedAt !== undefined;

/** Earliest `acceptedAt` among running jobs, or null. The host sets one timer from it. */
export function earliestRunning(jobs: readonly TimedJob[]): number | null {
  let min: number | null = null;
  for (const j of jobs)
    if (isRunning(j) && (min === null || j.acceptedAt! < min)) min = j.acceptedAt!;
  return min;
}

/** True when some running job has been running for at least `LONG_JOB_MS`. */
export function hasLongJob(jobs: readonly TimedJob[], now: number): boolean {
  return jobs.some((j) => isRunning(j) && now - j.acceptedAt! >= LONG_JOB_MS);
}

/** Milliseconds until the 20 s mark of the earliest running job (0 = already past), or null. */
export function longJobDelay(jobs: readonly TimedJob[], now: number): number | null {
  const first = earliestRunning(jobs);
  return first === null ? null : Math.max(0, first + LONG_JOB_MS - now);
}

export interface PrePromptDeps {
  /** Shows the sheet; true = "Notify me". */
  confirm(surface: PromptSurface): Promise<boolean>;
  /** The OS dialog; true = granted. */
  request(): Promise<boolean>;
  prompted(surface: PromptSurface): void;
  result(granted: boolean, surface: PromptSurface): void;
  now(): number;
  /** Persists `pushPrePromptDismissedAt`. */
  markDismissed(at: number): void;
}

/**
 * Pre-prompt sheet, then the OS dialog. `push_permission_prompted` when the sheet shows,
 * `push_permission_result` after the OS answer (or `granted:false` on "Not now"). "Not now" and an OS
 * denial both start the 30-day quiet window.
 */
export async function runPrePrompt(surface: PromptSurface, deps: PrePromptDeps): Promise<boolean> {
  deps.prompted(surface);
  if (!(await deps.confirm(surface))) {
    deps.markDismissed(deps.now());
    deps.result(false, surface);
    return false;
  }
  const granted = await deps.request();
  if (!granted) deps.markDismissed(deps.now());
  deps.result(granted, surface);
  return granted;
}

export type LongJobCheck =
  | { action: 'none' }
  | { action: 'wait'; ms: number }
  | { action: 'skip' }
  | { action: 'prompt'; granted: boolean };

export interface LongJobDeps {
  jobs(): readonly TimedJob[];
  now(): number;
  /** False while the app is not in the foreground: no dialog is shown to a backgrounded app. */
  active(): boolean;
  permission(): Promise<PermissionState>;
  dismissedAt(): number | null | undefined;
  /** Runs the pre-prompt flow (`surface: 'long_job'`); true = granted. */
  prompt(): Promise<boolean>;
}

/**
 * Called when a job starts and again when the timer fires: nothing running -> `none`; the earliest running
 * job has not reached 20 s -> `wait` (schedule); otherwise ask only if the OS state is undetermined and
 * the 30-day window is clear. Android < 13 reports `granted` and so never prompts.
 */
export async function checkLongJobPrompt(deps: LongJobDeps): Promise<LongJobCheck> {
  const now = deps.now();
  const delay = longJobDelay(deps.jobs(), now);
  if (delay === null) return { action: 'none' };
  if (delay > 0) return { action: 'wait', ms: delay };
  if (!deps.active()) return { action: 'skip' };
  const permission = await deps.permission();
  if (!shouldAutoPrompt({ permission, dismissedAt: deps.dismissedAt(), now })) {
    return { action: 'skip' };
  }
  return { action: 'prompt', granted: await deps.prompt() };
}
