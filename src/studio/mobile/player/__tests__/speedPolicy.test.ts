import { reversedProxyTime, sourceTimeAt } from '../../../speed';
import { clipPlayback, playbackTarget, shouldStep, STEP_STUCK_MS } from '../speedPolicy';
import { clip } from '../testing/sim';

const times = (start: number, end: number, n = 25) =>
  Array.from({ length: n }, (_, i) => start + ((end - start) * i) / (n - 1));

describe('clipPlayback: the four-number source mapping equals the copied speed model', () => {
  it('speed 1 forward plays at the player rate, with sound', () => {
    const c = clip({ id: 'c', timelineStart: 3, sourceIn: 2, sourceOut: 8 });
    const p = clipPlayback(c, false, 60);
    expect([p.mode, p.reversedSource, p.muted]).toEqual(['play', false, false]);
    for (const t of times(3, 9)) expect(playbackTarget(p, t)).toBeCloseTo(sourceTimeAt(c, t), 9);
  });

  it.each([0.25, 0.5, 2, 4, 10])('speed %s is frame-stepped and muted (no player rate in 0.22.0)', (speed) => {
    const c = clip({ id: 'c', timelineStart: 1, sourceIn: 0, sourceOut: 6, speed });
    const p = clipPlayback(c, false, 60);
    expect([p.mode, p.muted]).toEqual(['step', true]);
    for (const t of times(1, 1 + 6 / speed)) expect(playbackTarget(p, t)).toBeCloseTo(sourceTimeAt(c, t), 9);
  });

  it('reverse with a ready reversed proxy plays that file forward, mirrored through its duration', () => {
    const c = clip({ id: 'c', timelineStart: 2, sourceIn: 1, sourceOut: 7, reverse: true });
    const D = 20;
    const p = clipPlayback(c, true, D);
    expect([p.mode, p.reversedSource, p.muted]).toEqual(['play', true, false]);
    for (const t of times(2, 8)) expect(playbackTarget(p, t)).toBeCloseTo(reversedProxyTime(sourceTimeAt(c, t), D), 9);
  });

  it('reverse at speed 2 on the reversed proxy is stepped', () => {
    const c = clip({ id: 'c', timelineStart: 0, sourceIn: 0, sourceOut: 8, reverse: true, speed: 2 });
    const p = clipPlayback(c, true, 30);
    expect([p.mode, p.reversedSource]).toEqual(['step', true]);
    for (const t of times(0, 4)) expect(playbackTarget(p, t)).toBeCloseTo(reversedProxyTime(sourceTimeAt(c, t), 30), 9);
  });

  it('reverse before the reversed proxy exists steps backwards on the proxy, silent', () => {
    const c = clip({ id: 'c', timelineStart: 4, sourceIn: 2, sourceOut: 6, reverse: true });
    const p = clipPlayback(c, false, 30);
    expect([p.mode, p.reversedSource, p.muted]).toEqual(['step', false, true]);
    for (const t of times(4, 8)) expect(playbackTarget(p, t)).toBeCloseTo(sourceTimeAt(c, t), 9);
  });

  it('a freeze holds one source frame', () => {
    const c = clip({ id: 'c', timelineStart: 1, sourceIn: 3, sourceOut: 5, freeze: { sourceTime: 3.5 } } as never);
    const p = clipPlayback(c, false, 30);
    expect([p.mode, p.muted]).toEqual(['hold', true]);
    for (const t of times(1, 3)) expect(playbackTarget(p, t)).toBe(sourceTimeAt(c, t));
  });

  it('clamps a hair past either end like sourceTimeAt', () => {
    const c = clip({ id: 'c', timelineStart: 0, sourceIn: 1, sourceOut: 3, speed: 2 });
    const p = clipPlayback(c, false, 30);
    expect(playbackTarget(p, -1)).toBe(1);
    expect(playbackTarget(p, 99)).toBe(3);
  });
});

describe('shouldStep', () => {
  // (target, lastTarget, lastAtMs, inFlight, nowMs, minIntervalMs, minDelta)
  const F = 33.3;
  const D = 1 / 60;

  it('steps first, then at most once per project frame', () => {
    expect(shouldStep(1, NaN, -1e9, false, 0, F, D)).toBe(true);
    expect(shouldStep(1, 0.5, -10, false, 0, F, D)).toBe(false);
    expect(shouldStep(1, 0.5, -40, false, 0, F, D)).toBe(true);
  });

  it('keeps one step in flight, giving up after STEP_STUCK_MS', () => {
    expect(shouldStep(1, 0, -100, true, 0, F, D)).toBe(false);
    expect(shouldStep(1, 0, -STEP_STUCK_MS, true, 0, F, D)).toBe(true);
  });

  it('skips a move under half a source frame', () => {
    expect(shouldStep(1, 1 - 0.01, -100, false, 0, F, D)).toBe(false);
    expect(shouldStep(1, 1 - 0.02, -100, false, 0, F, D)).toBe(true);
  });
});
