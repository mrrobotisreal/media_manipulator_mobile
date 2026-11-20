// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/qualityGovernor.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  DEGRADE_RATIO_THRESHOLD,
  DEGRADE_SUSTAIN_SECONDS,
  QUALITY_SCALE,
  createFrameStats,
  createGovernor,
  frameStatsPush,
  governorPause,
  governorSecond,
  governorSetUserLevel,
  type FrameStats,
  type FrameWindowSample,
  type GovernorState,
} from './qualityGovernor';

const BAD = DEGRADE_RATIO_THRESHOLD + 0.1;
const GOOD = DEGRADE_RATIO_THRESHOLD - 0.1;

/** Run N one-second windows through the governor. */
function seconds(state: GovernorState, ratios: number[]): GovernorState {
  return ratios.reduce((s, r) => governorSecond(s, r), state);
}

describe('quality governor', () => {
  it('starts at the user level, not degraded', () => {
    const g = createGovernor('half');
    expect(g.effectiveLevel).toBe('half');
    expect(g.degraded).toBe(false);
    expect(g.degradeActivations).toBe(0);
  });

  it('steps down after sustained over-budget seconds', () => {
    let g = createGovernor('full');
    g = seconds(g, Array(DEGRADE_SUSTAIN_SECONDS - 1).fill(BAD));
    expect(g.effectiveLevel).toBe('full'); // not sustained long enough yet
    g = governorSecond(g, BAD);
    expect(g.effectiveLevel).toBe('half');
    expect(g.degraded).toBe(true);
    expect(g.degradeActivations).toBe(1);
  });

  it('keeps stepping down to the quarter floor and stays there', () => {
    let g = createGovernor('full');
    g = seconds(g, Array(DEGRADE_SUSTAIN_SECONDS * 3).fill(BAD));
    expect(g.effectiveLevel).toBe('quarter');
    expect(g.degradeActivations).toBe(2);
    g = seconds(g, Array(DEGRADE_SUSTAIN_SECONDS * 2).fill(BAD));
    expect(g.effectiveLevel).toBe('quarter');
    expect(g.degradeActivations).toBe(2); // the floor is not an activation
  });

  it('a good second resets the sustain counter', () => {
    let g = createGovernor('full');
    g = seconds(g, [BAD, GOOD, BAD, GOOD, BAD, GOOD]);
    expect(g.effectiveLevel).toBe('full');
    expect(g.degraded).toBe(false);
  });

  it('a ratio exactly at the threshold does not count as over budget', () => {
    let g = createGovernor('full');
    g = seconds(g, Array(DEGRADE_SUSTAIN_SECONDS * 2).fill(DEGRADE_RATIO_THRESHOLD));
    expect(g.effectiveLevel).toBe('full');
  });

  it('pause restores the user-selected level and clears the indicator', () => {
    let g = createGovernor('full');
    g = seconds(g, Array(DEGRADE_SUSTAIN_SECONDS * 2).fill(BAD));
    expect(g.effectiveLevel).toBe('quarter');
    g = governorPause(g);
    expect(g.effectiveLevel).toBe('full');
    expect(g.degraded).toBe(false);
    expect(g.degradeActivations).toBe(2); // lifetime count survives
  });

  it('manual selection always wins until the next degrade event', () => {
    let g = createGovernor('full');
    g = seconds(g, Array(DEGRADE_SUSTAIN_SECONDS).fill(BAD));
    expect(g.effectiveLevel).toBe('half');
    g = governorSetUserLevel(g, 'full');
    expect(g.effectiveLevel).toBe('full');
    expect(g.degraded).toBe(false);
    // …but a fresh sustained overload degrades again from the new pick.
    g = seconds(g, Array(DEGRADE_SUSTAIN_SECONDS).fill(BAD));
    expect(g.effectiveLevel).toBe('half');
    expect(g.degraded).toBe(true);
  });

  it('returns the same state object when nothing changed', () => {
    const g = createGovernor('full');
    expect(governorSecond(g, GOOD)).toBe(g);
    expect(governorPause(g)).toBe(g);
  });

  it('exposes the render scales the compositor uses', () => {
    expect(QUALITY_SCALE.full).toBe(1);
    expect(QUALITY_SCALE.half).toBe(0.5);
    expect(QUALITY_SCALE.quarter).toBe(0.25);
  });
});

describe('frame stats', () => {
  /** Feed a synthetic stream of deltas; collect completed window samples. */
  function run(dts: number[]): { samples: FrameWindowSample[]; stats: FrameStats } {
    let stats = createFrameStats();
    const samples: FrameWindowSample[] = [];
    for (const dt of dts) {
      const r = frameStatsPush(stats, dt);
      stats = r.stats;
      if (r.sample) samples.push(r.sample);
    }
    return { samples, stats };
  }

  it('a healthy 60 Hz stream reports ~60 fps and ~0 dropped', () => {
    const { samples } = run(Array(61).fill(1000 / 60));
    expect(samples).toHaveLength(1);
    expect(samples[0].fps).toBeCloseTo(60, 0);
    expect(samples[0].droppedFrameRatio).toBeLessThan(0.05);
  });

  it('a machine limping at half rate reports a high dropped ratio', () => {
    // One fast frame reveals the display can do 60; the rest arrive at 30 fps.
    const { samples } = run([1000 / 60, ...Array(30).fill(1000 / 30)]);
    expect(samples).toHaveLength(1);
    expect(samples[0].droppedFrameRatio).toBeGreaterThan(DEGRADE_RATIO_THRESHOLD);
  });

  it('a healthy 120 Hz display is not graded against 60', () => {
    const { samples } = run(Array(121).fill(1000 / 120));
    expect(samples[0].fps).toBeCloseTo(120, 0);
    expect(samples[0].droppedFrameRatio).toBeLessThan(0.05);
  });

  it('a healthy 30 Hz display is not reported as 50% dropped', () => {
    const { samples } = run(Array(31).fill(1000 / 30));
    expect(samples[0].droppedFrameRatio).toBeLessThan(0.05);
  });

  it('ignores absurd deltas (background tab, breakpoint) instead of counting drops', () => {
    const stats = createFrameStats();
    const r = frameStatsPush(stats, 5000);
    expect(r.sample).toBeNull();
    expect(r.stats).toBe(stats);
  });

  it('starts a fresh window after emitting a sample', () => {
    const { stats } = run(Array(61).fill(1000 / 60));
    expect(stats.elapsedMs).toBe(0);
    expect(stats.frames).toBe(0);
  });
});
