/**
 * VideoPool + PreviewDriver + the UI-runtime pump, end to end on fake players (ticket MA62 S1):
 * slot assignment, 2 s pre-roll, ±10 s release, reversed proxy, frame-stepped speed, the 3 s
 * no-frame failure, landing re-seeks, the 250 ms scrub wait and seek-only drift correction.
 */
import { NO_FRAME_TIMEOUT_MS, PREROLL_S, RETAIN_WINDOW_S } from '../VideoPool';
import { SCRUB_WAIT_MS } from '../framePump';
import { SLOT_COUNT } from '../types';
import { clip, createSim, lane } from '../testing/sim';
import type { FakeMediaSpec } from '../testing/fakePlayers';

const media = (keys: string[], spec: FakeMediaSpec = { duration: 60 }) =>
  Object.fromEntries(keys.map((k) => [k, spec]));

describe('slot assignment', () => {
  it('one slot per active clip, top-most visible first, the 5th concurrent clip skipped', () => {
    const tracks = [0, 1, 2, 3, 4].map((i) =>
      lane(`v${i}`, i, [clip({ id: `c${i}`, assetId: `a${i}`, timelineStart: 0 })]),
    );
    const keys = tracks.map((_, i) => `a${i}`);
    const sim = createSim({
      doc: { tracks, fps: 30 },
      assets: Object.fromEntries(keys.map((k) => [k, {}])),
      media: media(keys),
    });
    sim.run(200);
    const bound = sim.driver.pool.slots.map((s) => s.clipId);
    expect(bound.filter(Boolean)).toHaveLength(SLOT_COUNT);
    expect(bound).not.toContain('c0'); // bottom-most loses
    expect(sim.fakes.live()).toHaveLength(SLOT_COUNT);
  });

  it('titles, images (no media info) and assets still ingesting take no slot', () => {
    const tracks = [
      lane('v0', 0, [
        clip({ id: 'title', timelineStart: 0, assetId: '', title: { layers: [] } } as never),
        clip({ id: 'img', timelineStart: 0, assetId: 'img' }),
        clip({ id: 'ing', timelineStart: 0, assetId: 'ing' }),
      ]),
    ];
    const sim = createSim({ doc: { tracks, fps: 30 }, assets: { ing: { noUri: true } }, media: {} });
    sim.run(300);
    expect(sim.driver.pool.slots.every((s) => s.clipId === null)).toBe(true);
    expect(sim.fakes.made).toHaveLength(0);
  });

  it('scrubbing across a split clip (same source) reuses the player, no reload', () => {
    const a = clip({ id: 'left', timelineStart: 0, sourceIn: 0, sourceOut: 2 });
    const b = clip({ id: 'right', timelineStart: 2, sourceIn: 2, sourceOut: 6 });
    const sim = createSim({ doc: { tracks: [lane('v0', 0, [a, b])], fps: 30 }, assets: { a1: {} }, media: media(['a1']) });
    sim.seek(1);
    sim.run(300);
    sim.seek(3);
    sim.run(300);
    expect(sim.fakes.made).toHaveLength(1);
    expect(sim.driver.pool.slotOf('right')?.player).toBe(sim.fakes.made[0]);
    expect(sim.shown[sim.driver.pool.slotOf('right')!.index]).toBe(3);
  });

  it('while playing, the cut to the next part of the same file is pre-rolled on a second player (web MM70)', () => {
    const a = clip({ id: 'left', timelineStart: 0, sourceIn: 0, sourceOut: 2 });
    const b = clip({ id: 'right', timelineStart: 2, sourceIn: 10, sourceOut: 14 });
    const sim = createSim({ doc: { tracks: [lane('v0', 0, [a, b])], fps: 30 }, assets: { a1: {} }, media: media(['a1']) });
    sim.play();
    sim.run(500);
    const warm = sim.playerOf('right')!;
    expect(warm).not.toBe(sim.playerOf('left'));
    expect(warm.seeks[0]).toBe(10);
  });
});

describe('pre-roll and release', () => {
  it('loads the next clip on a track 2 s ahead, paused and silent, parked on its first frame', () => {
    const a = clip({ id: 'a', assetId: 'x', timelineStart: 0, sourceOut: 5 });
    const b = clip({ id: 'b', assetId: 'y', timelineStart: 5, sourceIn: 3, sourceOut: 9 });
    const sim = createSim({ doc: { tracks: [lane('v0', 0, [a, b])], fps: 30 }, assets: { x: {}, y: {} }, media: media(['x', 'y']) });
    sim.play();
    sim.run((5 - PREROLL_S - 0.3) * 1000);
    expect(sim.driver.pool.slotOf('b')).toBeUndefined();
    sim.run(500);
    const s = sim.driver.pool.slotOf('b')!;
    expect(s.role).toBe('preroll');
    const p = sim.playerOf('b')!;
    expect(p.seeks[0]).toBeCloseTo(3, 9);
    expect(p.paused).toBe(true);
    expect(p.volume).toBe(0);
    // The pump starts it on the frame its clip begins, and the driver opens its volume.
    sim.run(2200);
    expect(sim.driver.t).toBeGreaterThan(5);
    expect(sim.driver.pool.slotOf('b')!.role).toBe('active');
    expect(p.paused).toBe(false);
    expect(p.volume).toBe(1);
  });

  it(`keeps a player inside ±${RETAIN_WINDOW_S} s of the playhead and releases it outside`, () => {
    const a = clip({ id: 'a', assetId: 'x', timelineStart: 0, sourceOut: 2 });
    const b = clip({ id: 'b', assetId: 'y', timelineStart: 2, sourceOut: 30 });
    const sim = createSim({ doc: { tracks: [lane('v0', 0, [a, b])], fps: 30 }, assets: { x: {}, y: {} }, media: media(['x', 'y']) });
    sim.run(200);
    const pa = sim.playerOf('a')!;
    sim.seek(10);
    sim.run(200);
    expect(sim.driver.pool.slotOf('a')?.role).toBe('retained');
    expect(pa.released).toBe(false);
    sim.seek(12.5);
    sim.run(200);
    expect(sim.driver.pool.slotOf('a')).toBeUndefined();
    expect(pa.released).toBe(true);
  });

  it('dispose releases every player', () => {
    const tracks = [lane('v0', 0, [clip({ id: 'a', timelineStart: 0 })])];
    const sim = createSim({ doc: { tracks, fps: 30 }, assets: { a1: {} }, media: media(['a1']) });
    sim.run(200);
    sim.driver.dispose();
    expect(sim.fakes.live()).toHaveLength(0);
  });
});

describe('reverse and speed', () => {
  it('a reversed clip with a ready reversed proxy decodes proxy-reversed and plays it at its rate', () => {
    const c = clip({ id: 'r', timelineStart: 0, sourceIn: 2, sourceOut: 8, reverse: true });
    const sim = createSim({
      doc: { tracks: [lane('v0', 0, [c])], fps: 30 },
      assets: { a1: { reverseReady: true, duration: 20 } },
      media: { 'a1:r': { duration: 20 } },
    });
    sim.play();
    sim.run(1000);
    const p = sim.playerOf('r')!;
    expect(p.uri).toBe('a1:r');
    expect(p.paused).toBe(false);
    expect(p.seeks[0]).toBeCloseTo(20 - 8, 6);
  });

  it('speed 2 is frame-stepped: player paused, seeked at the project cadence, muted', () => {
    const c = clip({ id: 's', timelineStart: 0, sourceIn: 0, sourceOut: 10, speed: 2 });
    const sim = createSim({ doc: { tracks: [lane('v0', 0, [c])], fps: 30 }, assets: { a1: {} }, media: media(['a1']) });
    sim.play();
    sim.run(2000);
    const p = sim.playerOf('s')!;
    expect(p.paused).toBe(true);
    expect(p.volume).toBe(0);
    // ~1.9 s of steps at <= 30 per second (60 ms seek latency keeps one in flight).
    expect(p.seeks.length).toBeGreaterThan(15);
    expect(p.seeks.length).toBeLessThanOrEqual(62);
    // Targets advance at twice the timeline rate.
    const last = p.seeks[p.seeks.length - 1]!;
    expect(last).toBeGreaterThan(3);
    expect(last).toBeLessThanOrEqual(2 * (sim.driver.t + 0.05));
    for (let i = 1; i < p.seeks.length; i += 1) expect(p.seeks[i]!).toBeGreaterThanOrEqual(p.seeks[i - 1]! - 1e-9);
  });
});

describe('failure: no error event, 3 s without a frame', () => {
  it('a corrupt file (no frames, duration 0) fails after 3 s and is not reloaded', () => {
    const c = clip({ id: 'bad', timelineStart: 0, assetId: 'bad' });
    const sim = createSim({ doc: { tracks: [lane('v0', 0, [c])], fps: 30 }, assets: { bad: {} }, media: { bad: { duration: 60, broken: true } } });
    sim.run(NO_FRAME_TIMEOUT_MS - 300);
    expect(sim.driver.pool.slotOf('bad')!.failed).toBe(false);
    sim.run(600);
    const s = sim.driver.pool.slotOf('bad')!;
    expect(s.failed).toBe(true);
    expect(s.player).toBeNull();
    expect(sim.fakes.live()).toHaveLength(0);
    sim.run(5000);
    expect(sim.fakes.made).toHaveLength(1);
    sim.driver.pool.clearFailures();
    sim.run(200);
    expect(sim.fakes.made).toHaveLength(2);
  });

  it('a missing file (factory throws) fails at once', () => {
    const c = clip({ id: 'gone', timelineStart: 0, assetId: 'gone' });
    const sim = createSim({ doc: { tracks: [lane('v0', 0, [c])], fps: 30 }, assets: { gone: {} }, media: { gone: { duration: 1, missing: true } } });
    sim.run(150);
    expect(sim.driver.pool.slotOf('gone')!.failed).toBe(true);
  });

  it('a healthy paused slot is not failed for producing no frames', () => {
    const sim = createSim({
      doc: { tracks: [lane('v0', 0, [clip({ id: 'a', timelineStart: 0 })])], fps: 30 },
      assets: { a1: {} },
      media: media(['a1']),
    });
    sim.run(10_000);
    expect(sim.driver.pool.slotOf('a')!.failed).toBe(false);
  });

  it('an audio-only proxy never fails on frames', () => {
    const c = clip({ id: 'm', timelineStart: 0, assetId: 'music' });
    const sim = createSim({
      doc: { tracks: [lane('a0', 0, [c], { kind: 'audio' })], fps: 30 },
      assets: { music: { kind: 'audio' } },
      media: { music: { duration: 60, broken: true } },
    });
    sim.play();
    sim.run(6000);
    expect(sim.driver.pool.slotOf('m')!.failed).toBe(false);
  });
});

describe('scrub: landing re-seek and the 250 ms wait (MA59)', () => {
  const setup = (overshoot: (i: number) => boolean) =>
    createSim({
      doc: { tracks: [lane('v0', 0, [clip({ id: 'a', timelineStart: 0, sourceOut: 60 })])], fps: 30 },
      assets: { a1: {} },
      media: { a1: { duration: 60, seekLatencyMs: 50, overshoot, overshootFrames: 19 } },
    });

  it('re-seeks once on landing, never shows the overshoot frame, lands exactly', () => {
    // The first seek after each pair overshoots (like ~half of MA59's single seeks).
    const sim = setup((i) => i % 2 === 0);
    sim.run(500);
    sim.seek(12.4);
    const p = sim.playerOf('a')!;
    const n = p.seeks.length;
    const took = sim.until(() => sim.shown[sim.driver.pool.slotOf('a')!.index] !== null && Math.abs(sim.shown[0]! - 12.4) < 1e-9, 1000);
    expect(took).toBeGreaterThan(0);
    expect(took).toBeLessThan(250);
    expect(p.seeks.slice(n)).toEqual([12.4, 12.4]);
    // The overshoot content (12.4 + 19/30) never reached the texture.
    expect(sim.shown).not.toContain(12.4 + 19 / 30);
  });

  it('a slow decoder: the first frame is shown after 250 ms while the re-seek runs', () => {
    const sim = createSim({
      doc: { tracks: [lane('v0', 0, [clip({ id: 'a', timelineStart: 0, sourceOut: 60 })])], fps: 30 },
      assets: { a1: {} },
      media: { a1: { duration: 60, seekLatencyMs: 300 } },
    });
    sim.run(800);
    sim.seek(20);
    const t0 = sim.now;
    sim.until(() => sim.shown[0] === 20, 2000);
    expect(sim.now - t0).toBeGreaterThanOrEqual(300);
    expect(sim.now - t0).toBeLessThan(400);
  });

  it('rapid scrubbing keeps one seek in flight and lands on the newest target', () => {
    const sim = setup(() => false);
    sim.run(300);
    const p = sim.playerOf('a')!;
    const n = p.seeks.length;
    for (let k = 0; k < 10; k += 1) {
      sim.seek(5 + k * 0.5);
      sim.run(16);
    }
    sim.until(() => sim.shown[0] === 9.5, 2000);
    const issued = p.seeks.slice(n);
    expect(issued[issued.length - 1]).toBe(9.5);
    expect(issued.length).toBeLessThan(10 * 2); // newest-wins coalescing, not one per drag event
    expect(sim.shown[0]).toBe(9.5);
  });

  it('pause re-lands every slot exactly on the playhead', () => {
    const sim = setup(() => false);
    sim.play();
    sim.run(1500);
    sim.pause();
    sim.run(400);
    const t = sim.driver.t;
    expect(sim.shown[0]).toBeCloseTo(t, 9);
  });
});

describe('drift: seek-only, 2-frame dead band', () => {
  // The drifting player is on the bottom track: the top one is the master the clock follows.
  const two = (rateBottom: number) =>
    createSim({
      doc: {
        tracks: [
          lane('v0', 0, [clip({ id: 'a', assetId: 'x', timelineStart: 0, sourceOut: 60 })]),
          lane('v1', 1, [clip({ id: 'b', assetId: 'y', timelineStart: 0, sourceOut: 60 })]),
        ],
        fps: 30,
      },
      assets: { x: {}, y: {} },
      media: { x: { duration: 60, rate: rateBottom }, y: { duration: 60 } },
    });

  it('players in step make no correction seeks', () => {
    const sim = two(1);
    sim.play();
    sim.run(20_000);
    expect(sim.driver.sync.reduce((n, b) => n + b.corrections, 0)).toBe(0);
  });

  it('a drifting player is seeked back, staying within a few frames of the playhead', () => {
    const sim = two(1.02); // +0.6 frames per second at 30 fps
    sim.play();
    let worst = 0;
    for (let k = 0; k < 200; k += 1) {
      sim.run(100);
      const pa = sim.playerOf('a')!;
      const pm = sim.playerOf('b')!;
      if (sim.now > 2000) worst = Math.max(worst, Math.abs(pa.currentTime - pm.currentTime) * 30);
    }
    const a = sim.driver.pool.slotOf('a')!;
    expect(sim.driver.sync[a.index]!.corrections).toBeGreaterThan(0);
    expect(sim.driver.sync[sim.driver.pool.slotOf('b')!.index]!.corrections).toBe(0);
    // dead band 2 frames + a tick of drift + the seek lead: never far off.
    expect(worst).toBeLessThan(6);
  });

  it('the playhead follows the master (the top-most audible clip)', () => {
    const sim = two(1);
    sim.play();
    sim.run(3000);
    expect(sim.driver.clock.state.masterSlot).toBe(sim.driver.pool.slotOf('b')!.index);
    expect(Math.abs(sim.driver.t - sim.playerOf('b')!.currentTime)).toBeLessThan(0.1);
  });

  it('releases every frame it pulls (none left held)', () => {
    const sim = two(1.01);
    sim.play();
    sim.run(5000);
    sim.pause();
    sim.run(500);
    for (const p of sim.fakes.made) expect(p.frames.every((f) => f.released)).toBe(true);
  });
});

describe('the pump publishes to the canvas only through numbers', () => {
  it('bumps the redraw counter per copied frame batch and exposes per-slot counters', () => {
    const sim = createSim({
      doc: { tracks: [lane('v0', 0, [clip({ id: 'a', timelineStart: 0, sourceOut: 60 })])], fps: 30 },
      assets: { a1: {} },
      media: media(['a1']),
    });
    sim.play();
    sim.run(1000);
    const st = sim.bridge.state;
    expect(st.redraw).toBeGreaterThan(20);
    expect(st.frames[0]).toBe(st.redraw);
    for (const k of Object.keys(st) as (keyof typeof st)[]) {
      const v = st[k];
      expect(typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number'))).toBe(true);
    }
    expect(SCRUB_WAIT_MS).toBe(250);
  });
});
