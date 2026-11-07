import {
  createRecorderController,
  meterLevel,
  POLL_MS,
  type RecorderDeps,
  type RecorderState,
} from '../recorder';

function setup(over: Partial<RecorderDeps> = {}, perm = { granted: true, canAskAgain: true }) {
  let now = 0;
  let tick: (() => void) | null = null;
  let appState: ((s: string) => void) | null = null;
  const states: RecorderState[] = [];
  const recorder = {
    uri: 'file:///cache/rec.m4a' as string | null,
    prepareToRecordAsync: jest.fn(() => Promise.resolve()),
    record: jest.fn(),
    stop: jest.fn(() => Promise.resolve()),
    getStatus: jest.fn(() => ({ durationMillis: now, metering: -30 })),
  };
  const deps: RecorderDeps = {
    requestPermission: jest.fn(() => Promise.resolve(perm)),
    recorder,
    setRecordingMode: jest.fn(() => Promise.resolve()),
    onAppState: (cb) => {
      appState = cb;
      return () => (appState = null);
    },
    setInterval: (fn) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => (tick = null),
    onChange: (s) => states.push(s),
    maxSeconds: 60,
    ...over,
  };
  const c = createRecorderController(deps);
  return {
    c,
    deps,
    recorder,
    states,
    advance: (ms: number) => {
      now += ms;
      tick?.();
    },
    background: () => appState?.('background'),
    hasTimer: () => tick !== null,
  };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('recorder controller (MA34 decision 4)', () => {
  it('asks for the permission on the first Record, then records', async () => {
    const t = setup();
    expect(t.deps.requestPermission).not.toHaveBeenCalled();
    await t.c.start();
    expect(t.deps.requestPermission).toHaveBeenCalledTimes(1);
    expect(t.deps.setRecordingMode).toHaveBeenCalledWith(true);
    expect(t.recorder.prepareToRecordAsync).toHaveBeenCalled();
    expect(t.recorder.record).toHaveBeenCalled();
    expect(t.c.state.phase).toBe('recording');
  });

  it('permission denied (can ask again) and blocked (cannot) never start a recording', async () => {
    const denied = setup({}, { granted: false, canAskAgain: true });
    await denied.c.start();
    expect(denied.c.state.phase).toBe('denied');
    expect(denied.recorder.record).not.toHaveBeenCalled();
    const blocked = setup({}, { granted: false, canAskAgain: false });
    await blocked.c.start();
    expect(blocked.c.state.phase).toBe('blocked');
    expect(blocked.recorder.record).not.toHaveBeenCalled();
  });

  it('shows the clock and the level while recording', async () => {
    const t = setup();
    await t.c.start();
    t.advance(2500);
    expect(t.c.state.elapsedMs).toBe(2500);
    expect(t.c.state.level).toBeCloseTo(0.5, 2);
    expect(meterLevel(-60)).toBe(0);
    expect(meterLevel(0)).toBe(1);
    expect(meterLevel(undefined)).toBe(0);
  });

  it('auto-stops at 60 s and reports exactly 60 s', async () => {
    const t = setup();
    await t.c.start();
    t.advance(59_900);
    expect(t.c.state.phase).toBe('recording');
    t.advance(300);
    await flush();
    expect(t.recorder.stop).toHaveBeenCalledTimes(1);
    expect(t.c.state.phase).toBe('recorded');
    expect(t.c.state.autoStopped).toBe(true);
    expect(t.c.state.durationSec).toBe(60);
    expect(t.c.state.verdict).toBe('ok');
    expect(t.hasTimer()).toBe(false);
    expect(t.deps.setRecordingMode).toHaveBeenLastCalledWith(false);
  });

  it('a 3 s take has the too_short verdict; 5 s and 60 s are ok', async () => {
    const t = setup();
    await t.c.start();
    t.advance(3000);
    await t.c.stop();
    expect(t.c.state.verdict).toBe('too_short');
    expect(t.c.state.uri).toBe('file:///cache/rec.m4a');
    const u = setup();
    await u.c.start();
    u.advance(5000);
    await u.c.stop();
    expect(u.c.state.verdict).toBe('ok');
  });

  it('going to the background stops the take (never a background recording)', async () => {
    const t = setup();
    await t.c.start();
    t.advance(8000);
    t.background();
    await flush();
    expect(t.recorder.stop).toHaveBeenCalledTimes(1);
    expect(t.c.state.phase).toBe('recorded');
    expect(t.c.state.interrupted).toBe(true);
    expect(t.c.state.durationSec).toBe(8);
  });

  it('a recorder that throws on prepare ends in error and restores the audio mode', async () => {
    const t = setup();
    t.recorder.prepareToRecordAsync.mockRejectedValueOnce(new Error('busy'));
    await t.c.start();
    expect(t.c.state.phase).toBe('error');
    expect(t.deps.setRecordingMode).toHaveBeenLastCalledWith(false);
  });

  it('Discard clears the take; a second Record starts clean', async () => {
    const t = setup();
    await t.c.start();
    t.advance(6000);
    await t.c.stop();
    t.c.discard();
    expect(t.c.state.phase).toBe('idle');
    expect(t.c.state.uri).toBeNull();
    await t.c.start();
    expect(t.c.state.phase).toBe('recording');
    expect(t.c.state.elapsedMs).toBe(0);
  });

  it('a stop with no file is an error, and a double stop is ignored', async () => {
    const t = setup();
    t.recorder.uri = null;
    t.recorder.getStatus.mockReturnValue({ durationMillis: 7000, metering: -20 });
    await t.c.start();
    await Promise.all([t.c.stop(), t.c.stop()]);
    expect(t.recorder.stop).toHaveBeenCalledTimes(1);
    expect(t.c.state.phase).toBe('error');
  });

  it('polls on the documented interval constant', () => {
    expect(POLL_MS).toBeGreaterThan(0);
  });
});
