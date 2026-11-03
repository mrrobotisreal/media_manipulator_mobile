import {
  LONG_JOB_MS,
  REASK_MS,
  checkLongJobPrompt,
  runPrePrompt,
  shouldAutoPrompt,
  type LongJobDeps,
  type PrePromptDeps,
  type TimedJob,
} from '../prePrompt';
import { getPermissionState, needsRuntimePermission, type PermissionDeps } from '../permission';

const NOW = 1_000_000;
const running = (acceptedAt: number): TimedJob => ({ state: 'processing', acceptedAt });

function longDeps(over: Partial<LongJobDeps> = {}): LongJobDeps & { prompt: jest.Mock } {
  return {
    jobs: () => [running(NOW - LONG_JOB_MS)],
    now: () => NOW,
    active: () => true,
    permission: async () => 'undetermined',
    dismissedAt: () => null,
    prompt: jest.fn(async () => true),
    ...over,
  } as LongJobDeps & { prompt: jest.Mock };
}

describe('long job pre-prompt trigger', () => {
  it('asks only once a job has run 20 s and permission is undetermined', async () => {
    const early = longDeps({ jobs: () => [running(NOW - LONG_JOB_MS + 5000)] });
    expect(await checkLongJobPrompt(early)).toEqual({ action: 'wait', ms: 5000 });
    expect(early.prompt).not.toHaveBeenCalled();

    const late = longDeps();
    expect(await checkLongJobPrompt(late)).toEqual({ action: 'prompt', granted: true });
    expect(late.prompt).toHaveBeenCalledTimes(1);

    const decided = longDeps({ permission: async () => 'granted' });
    expect(await checkLongJobPrompt(decided)).toEqual({ action: 'skip' });
    const denied = longDeps({ permission: async () => 'denied' });
    expect(await checkLongJobPrompt(denied)).toEqual({ action: 'skip' });
    expect(await checkLongJobPrompt(longDeps({ jobs: () => [] }))).toEqual({ action: 'none' });
    expect(
      await checkLongJobPrompt(
        longDeps({ jobs: () => [{ state: 'uploading' }, { state: 'completed' }] }),
      ),
    ).toEqual({ action: 'none' });
  });

  it('never shows a dialog to a backgrounded app', async () => {
    const d = longDeps({ active: () => false });
    expect(await checkLongJobPrompt(d)).toEqual({ action: 'skip' });
    expect(d.prompt).not.toHaveBeenCalled();
  });

  it('Not now suppresses auto-asks for 30 days', () => {
    const base = { permission: 'undetermined' as const, now: NOW };
    expect(shouldAutoPrompt({ ...base, dismissedAt: NOW - 1000 })).toBe(false);
    expect(shouldAutoPrompt({ ...base, dismissedAt: NOW - REASK_MS + 1 })).toBe(false);
    expect(shouldAutoPrompt({ ...base, dismissedAt: NOW - REASK_MS })).toBe(true);
    expect(shouldAutoPrompt({ ...base, dismissedAt: null })).toBe(true);
    expect(REASK_MS).toBe(30 * 24 * 3600 * 1000);
  });
});

describe('Android below 13', () => {
  const dep = (version: number, os = 'android'): PermissionDeps => ({
    os,
    version,
    getStatus: jest.fn(async () => 'undetermined' as const),
    request: jest.fn(async () => 'granted' as const),
  });
  it('Android below 13 registers without prompting', async () => {
    const d = dep(32);
    expect(needsRuntimePermission(d)).toBe(false);
    // "granted" short-circuits: the token path registers and the trigger skips the sheet.
    expect(await getPermissionState(d)).toBe('granted');
    expect(d.getStatus).not.toHaveBeenCalled();
    expect(await checkLongJobPrompt(longDeps({ permission: () => getPermissionState(d) }))).toEqual(
      {
        action: 'skip',
      },
    );
  });
  it('Android 13+ and iOS read the OS state', async () => {
    expect(await getPermissionState(dep(33))).toBe('undetermined');
    expect(await getPermissionState(dep(17, 'ios'))).toBe('undetermined');
  });
});

describe('pre-prompt flow events', () => {
  function flow(confirm: boolean, os: boolean) {
    const calls: string[] = [];
    const deps: PrePromptDeps = {
      confirm: async () => (calls.push('sheet'), confirm),
      request: async () => (calls.push('os'), os),
      prompted: (s) => void calls.push(`prompted:${s}`),
      result: (g, s) => void calls.push(`result:${g}:${s}`),
      now: () => NOW,
      markDismissed: (at) => void calls.push(`dismissed:${at}`),
    };
    return { deps, calls };
  }
  it('prompted and result events carry surface', async () => {
    const a = flow(true, true);
    expect(await runPrePrompt('long_job', a.deps)).toBe(true);
    expect(a.calls).toEqual(['prompted:long_job', 'sheet', 'os', 'result:true:long_job']);

    const b = flow(false, true);
    expect(await runPrePrompt('settings', b.deps)).toBe(false);
    expect(b.calls).toEqual([
      'prompted:settings',
      'sheet',
      `dismissed:${NOW}`,
      'result:false:settings',
    ]);

    const c = flow(true, false);
    expect(await runPrePrompt('long_job', c.deps)).toBe(false);
    expect(c.calls).toEqual([
      'prompted:long_job',
      'sheet',
      'os',
      `dismissed:${NOW}`,
      'result:false:long_job',
    ]);
  });
});
