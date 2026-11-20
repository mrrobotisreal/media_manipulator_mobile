// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/playbackSync.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  AUDIO_RESYNC_S,
  BUFFER_STUCK_MS,
  bufferStuckMs,
  DEFAULT_SEEK_LATENCY_MS,
  HAVE_FUTURE_DATA,
  MAX_SEEK_LATENCY_MS,
  MIN_RESEEK_MS,
  NUDGE_MAX_RATIO,
  NUDGE_WINDOW_S,
  createSlotSync,
  masterClockStep,
  nextLatencyEstimate,
  noteSeekIssued,
  planSync,
  seekStuckMs,
  upcomingClips,
  type MediaSnapshot,
  type SlotSyncState,
  type SyncInput,
} from './playbackSync';

const PLAYABLE: MediaSnapshot = { currentTime: 10, seeking: false, readyState: 4 };

function input(over: Partial<Omit<SyncInput, 'el'>> & { el?: Partial<MediaSnapshot> } = {}): SyncInput {
  const { el, ...rest } = over;
  return {
    el: { ...PLAYABLE, ...el },
    target: 10,
    baseRate: 1,
    playing: true,
    nowMs: 100_000,
    latencyMs: DEFAULT_SEEK_LATENCY_MS,
    nudge: true,
    ...rest,
  };
}

const seekedAt = (ms: number, s: SlotSyncState = createSlotSync()): SlotSyncState => noteSeekIssued(s, ms);

describe('planSync — single-frame decisions', () => {
  const cases: Array<{ name: string; state?: SlotSyncState; in: SyncInput; kind: string; check?: (a: ReturnType<typeof planSync>) => void }> = [
    { name: 'in sync → base rate', in: input(), kind: 'rate', check: (r) => expect(r.action.rate).toBe(1) },
    {
      name: 'small drift behind → speed up, never seek',
      in: input({ el: { currentTime: 9.8 } }),
      kind: 'rate',
      check: (r) => {
        expect(r.action.rate).toBeGreaterThan(1);
        expect(r.action.rate).toBeLessThanOrEqual(1 + NUDGE_MAX_RATIO);
      },
    },
    {
      name: 'small drift ahead → slow down',
      in: input({ el: { currentTime: 10.2 } }),
      kind: 'rate',
      check: (r) => expect(r.action.rate).toBeLessThan(1),
    },
    {
      name: 'nudge scales with the clip speed',
      in: input({ el: { currentTime: 19.6 }, target: 20, baseRate: 2 }),
      kind: 'rate',
      check: (r) => {
        expect(r.action.rate).toBeGreaterThan(2);
        expect(r.action.rate).toBeLessThanOrEqual(2 * (1 + NUDGE_MAX_RATIO));
      },
    },
    {
      name: 'large drift → seek WITH a lead of the measured latency',
      in: input({ el: { currentTime: 8 }, latencyMs: 1200 }),
      kind: 'seek',
      check: (r) => {
        expect(r.action.kind === 'seek' && r.action.time).toBeCloseTo(11.2, 5);
        expect(r.state.seeks).toBe(1);
        expect(r.state.awaitingLanding).toBe(true);
      },
    },
    {
      name: 'lead is in media seconds (× speed)',
      in: input({ el: { currentTime: 10 }, target: 14, baseRate: 2, latencyMs: 500 }),
      kind: 'seek',
      check: (r) => expect(r.action.kind === 'seek' && r.action.time).toBeCloseTo(15, 5),
    },
    {
      name: 'lead never runs past the media end',
      in: input({ el: { currentTime: 1 }, target: 9.9, maxTime: 10, latencyMs: 2000 }),
      kind: 'seek',
      check: (r) => expect(r.action.kind === 'seek' && r.action.time).toBeCloseTo(9.95, 5),
    },
    {
      name: 'in-flight seek → hold, never stack another seek',
      state: seekedAt(99_800),
      in: input({ el: { currentTime: 5, seeking: true, readyState: 1 } }),
      kind: 'hold',
    },
    {
      name: 'large drift within the re-seek cooldown → rate only',
      state: { ...createSlotSync(), lastSeekAt: 100_000 - MIN_RESEEK_MS + 50, landedAt: 99_000 },
      in: input({ el: { currentTime: 8 } }),
      kind: 'rate',
    },
    {
      name: 'audio-only element: small drift stays at base rate (master audio is never stretched)',
      in: input({ el: { currentTime: 9.8 }, nudge: false }),
      kind: 'rate',
      check: (r) => expect(r.action.rate).toBe(1),
    },
    {
      name: 'audio-only element: drift past the resync threshold → seek',
      in: input({ el: { currentTime: 10 - AUDIO_RESYNC_S - 0.1 }, nudge: false }),
      kind: 'seek',
    },
    {
      name: 'paused, off target → exact seek, no lead',
      in: input({ playing: false, el: { currentTime: 3 }, latencyMs: 2000 }),
      kind: 'seek',
      check: (r) => {
        expect(r.action.kind === 'seek' && r.action.time).toBe(10);
        expect(r.action.kind === 'seek' && r.action.reason).toBe('exact');
      },
    },
    {
      name: 'paused, seek in flight → defer the newest target',
      state: seekedAt(99_900),
      in: input({ playing: false, el: { currentTime: 3, seeking: true } }),
      kind: 'defer',
      check: (r) => expect(r.action.kind === 'defer' && r.action.time).toBe(10),
    },
    {
      name: 'paused, on target → hold',
      in: input({ playing: false, el: { currentTime: 10.02 } }),
      kind: 'hold',
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = planSync(c.state ?? createSlotSync(), c.in);
      expect(r.action.kind).toBe(c.kind);
      c.check?.(r);
    });
  }

  it('reports the issue→playable latency once, when the seek lands', () => {
    let s = seekedAt(100_000);
    let r = planSync(s, input({ nowMs: 100_400, el: { seeking: true, readyState: 1 } }));
    expect(r.latencySampleMs).toBeUndefined();
    s = r.state;
    r = planSync(s, input({ nowMs: 100_700, el: { seeking: false, readyState: 2 } }));
    expect(r.latencySampleMs).toBeUndefined(); // seeked, but not playable yet
    s = r.state;
    r = planSync(s, input({ nowMs: 101_100, el: { readyState: HAVE_FUTURE_DATA } }));
    expect(r.latencySampleMs).toBe(1100);
    r = planSync(r.state, input({ nowMs: 101_120 }));
    expect(r.latencySampleMs).toBeUndefined();
  });
});

describe('latency estimate', () => {
  it('attacks fast and releases slowly, within bounds', () => {
    expect(nextLatencyEstimate(300, 1500)).toBe(1500);
    expect(nextLatencyEstimate(1500, 100)).toBeCloseTo(1080, 5);
    expect(nextLatencyEstimate(300, 60_000)).toBe(MAX_SEEK_LATENCY_MS);
    expect(nextLatencyEstimate(300, Number.NaN)).toBe(300);
  });
});

describe('stuck-state recovery (seeked never fires / buffer never fills)', () => {
  it('re-issues a seek that has stayed `seeking` past the stuck timeout, then holds again', () => {
    let s = seekedAt(0);
    const stuckEl = { currentTime: 4, seeking: true, readyState: 1 };
    // Before the timeout: hold every frame.
    let issued = 0;
    for (let ms = 16; ms < seekStuckMs(DEFAULT_SEEK_LATENCY_MS); ms += 16) {
      const r = planSync(s, input({ nowMs: ms, target: 4 + ms / 1000, el: stuckEl }));
      if (r.action.kind === 'seek') issued += 1;
      s = r.state;
    }
    expect(issued).toBe(0);
    const r = planSync(s, input({ nowMs: seekStuckMs(DEFAULT_SEEK_LATENCY_MS) + 20, target: 7, el: stuckEl }));
    expect(r.action.kind).toBe('seek');
    expect(r.action.kind === 'seek' && r.action.reason).toBe('stuck');
    // And the re-issued seek restarts the clock: no immediate second one.
    const r2 = planSync(r.state, input({ nowMs: seekStuckMs(DEFAULT_SEEK_LATENCY_MS) + 40, target: 7, el: stuckEl }));
    expect(r2.action.kind).toBe('hold');
  });

  it('a paused element whose seek was lost gets a fresh exact seek instead of deferring forever', () => {
    const s = seekedAt(0);
    const r = planSync(s, input({ playing: false, nowMs: seekStuckMs(DEFAULT_SEEK_LATENCY_MS) + 1, el: { currentTime: 3, seeking: true } }));
    expect(r.action.kind).toBe('seek');
  });

  it('re-kicks an element that buffers (waiting) for too long near its target', () => {
    let s: SlotSyncState = { ...createSlotSync(), lastSeekAt: -10_000, landedAt: -9_000 };
    const waitingEl = { currentTime: 10, seeking: false, readyState: 2 };
    let first: number | null = null;
    for (let ms = 0; ms <= bufferStuckMs(DEFAULT_SEEK_LATENCY_MS) + 100; ms += 16) {
      // Target drifts only slightly: not a "large drift" case.
      const r = planSync(s, input({ nowMs: ms, target: 10 + Math.min(ms, 300) / 1000, el: waitingEl }));
      s = r.state;
      if (r.action.kind === 'seek') {
        first = ms;
        expect(r.action.reason).toBe('stuck');
        break;
      }
      expect(r.action.kind).toBe('hold');
    }
    expect(first).not.toBeNull();
    expect(first!).toBeGreaterThan(bufferStuckMs(DEFAULT_SEEK_LATENCY_MS));
    expect(bufferStuckMs(DEFAULT_SEEK_LATENCY_MS)).toBe(BUFFER_STUCK_MS);
  });

  it('a buffering element far behind its target jumps ahead once, not every frame', () => {
    let s: SlotSyncState = { ...createSlotSync(), lastSeekAt: -10_000, landedAt: -9_000 };
    let seeks = 0;
    for (let ms = 0; ms < 2000; ms += 16) {
      const r = planSync(s, input({ nowMs: ms, target: 12 + ms / 1000, el: { currentTime: 10, readyState: 2 } }));
      s = r.state;
      if (r.action.kind === 'seek') seeks += 1;
    }
    // First frame jumps; the element is then `awaitingLanding` — and in this
    // synthetic case never lands, so the only further seek is the stuck re-kick
    // (which cannot happen inside 2 s).
    expect(seeks).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Closed-loop simulation — the MM70 repro. A fake element whose seeks take a
// fixed latency to become playable (network round trip + decode from the
// previous keyframe), driven at 60 Hz by the playhead, exactly the way
// preview-surface's rAF loop drives the pool.
// ---------------------------------------------------------------------------

class FakeEl implements MediaSnapshot {
  currentTime = 0;
  seeking = false;
  readyState = 4;
  playbackRate = 1;
  seeks = 0;
  frozenFrames = 0;
  private landAt = Infinity;
  /** When set, seeks number `loseSeek` never complete (`seeked` never fires). */
  loseSeek = -1;
  stallFrom = Infinity;
  stallTo = -Infinity;
  onSeeked: (() => void) | null = null;
  constructor(private latencyMs: number) {}
  seek(t: number, now: number) {
    this.seeks += 1;
    this.seeking = true;
    this.currentTime = t;
    this.readyState = 1;
    this.landAt = this.seeks === this.loseSeek ? Infinity : now + this.latencyMs;
  }
  tick(now: number, dt: number) {
    if (this.seeking && now >= this.landAt) {
      this.seeking = false;
      this.readyState = 4;
      this.landAt = Infinity;
      this.onSeeked?.();
    }
    const stalled = now >= this.stallFrom && now < this.stallTo;
    if (stalled && !this.seeking) this.readyState = 2;
    else if (!this.seeking && this.readyState === 2) this.readyState = 4;
    if (!this.seeking && this.readyState >= 3) this.currentTime += dt * this.playbackRate;
    else this.frozenFrames += 1;
  }
}

interface SimResult {
  seeks: number;
  tailMaxDrift: number;
  frozenFrames: number;
}

/** The pre-MM70 playing path: hard-seek to the CURRENT target past 0.3 s; coalesced re-issue on `seeked`. */
function simulateLegacy(el: FakeEl, seconds: number): SimResult {
  let pending: number | null = null;
  let now = 0;
  el.onSeeked = () => {
    const tgt = pending;
    pending = null;
    if (tgt != null && Math.abs(el.currentTime - tgt) > 0.05) el.seek(tgt, now);
  };
  let head = 0;
  const dt = 1 / 60;
  const drifts: number[] = [];
  for (let f = 0; f < seconds * 60; f += 1) {
    now += 1000 / 60;
    head += dt;
    el.tick(now, dt);
    if (Math.abs(el.currentTime - head) > 0.3) {
      if (el.seeking) pending = head;
      else {
        pending = null;
        el.seek(head, now);
      }
    }
    drifts.push(head - el.currentTime);
  }
  return { seeks: el.seeks, tailMaxDrift: Math.max(...drifts.slice(-300).map(Math.abs)), frozenFrames: el.frozenFrames };
}

/** The MM70 path: planSync per frame, the measured latency feeding the lead. */
function simulatePlanner(el: FakeEl, seconds: number): SimResult & { maxSeeksPerSecond: number } {
  let now = 0;
  let head = 0;
  let s = createSlotSync();
  let latency = DEFAULT_SEEK_LATENCY_MS;
  const dt = 1 / 60;
  const drifts: number[] = [];
  const seekFrames: number[] = [];
  for (let f = 0; f < seconds * 60; f += 1) {
    now += 1000 / 60;
    head += dt;
    el.tick(now, dt);
    const r = planSync(s, { el, target: head, baseRate: 1, playing: true, nowMs: now, latencyMs: latency, nudge: true });
    s = r.state;
    if (r.latencySampleMs !== undefined) latency = nextLatencyEstimate(latency, r.latencySampleMs);
    el.playbackRate = r.action.rate;
    if (r.action.kind === 'seek') {
      el.seek(r.action.time, now);
      seekFrames.push(f);
    }
    drifts.push(head - el.currentTime);
  }
  let maxSeeksPerSecond = 0;
  for (const f of seekFrames) {
    maxSeeksPerSecond = Math.max(maxSeeksPerSecond, seekFrames.filter((g) => g >= f && g < f + 60).length);
  }
  return {
    seeks: el.seeks,
    tailMaxDrift: Math.max(...drifts.slice(-300).map(Math.abs)),
    frozenFrames: el.frozenFrames,
    maxSeeksPerSecond,
  };
}

/** One 0.6 s network hiccup two seconds in — the trigger. */
function hiccupEl(latencyMs: number): FakeEl {
  const el = new FakeEl(latencyMs);
  el.stallFrom = 2000;
  el.stallTo = 2600;
  return el;
}

describe('closed loop: the MM70 seek storm', () => {
  // Seek latencies a 720p long-GOP proxy fetched across the Atlantic can show.
  const latencies = [100, 250, 400, 800, 1500, 3000];

  it('documents the bug: the legacy policy never re-syncs once seeks take longer than its 0.3 s threshold', () => {
    for (const L of [400, 800, 1500, 3000]) {
      const r = simulateLegacy(hiccupEl(L), 20);
      // Still out of sync 15 s after a 0.6 s hiccup, seeking over and over.
      expect(r.tailMaxDrift).toBeGreaterThan(0.3);
      expect(r.seeks).toBeGreaterThan(5);
    }
  });

  for (const L of latencies) {
    it(`recovers from a hiccup with ${L} ms seeks: back in sync, few seeks, never a storm`, () => {
      const r = simulatePlanner(hiccupEl(L), 20);
      expect(r.tailMaxDrift).toBeLessThanOrEqual(0.05);
      expect(r.seeks).toBeLessThanOrEqual(4);
      expect(r.maxSeeksPerSecond).toBeLessThanOrEqual(2);
    });
  }

  it('freezes far fewer frames than the legacy policy', () => {
    const legacy = simulateLegacy(hiccupEl(800), 20);
    const fixed = simulatePlanner(hiccupEl(800), 20);
    expect(fixed.frozenFrames).toBeLessThan(legacy.frozenFrames / 4);
  });

  it('recovers on its own when a seek is lost (seeked never fires) — no pause/play needed', () => {
    const el = hiccupEl(800);
    el.loseSeek = 1;
    const r = simulatePlanner(el, 25);
    expect(r.tailMaxDrift).toBeLessThanOrEqual(0.05);
    expect(r.seeks).toBeLessThanOrEqual(5);
  });

  it('a uniformly slow link (every seek takes 6 s) still lands: stuck re-issues back off', () => {
    const r = simulatePlanner(hiccupEl(6000), 60);
    expect(r.tailMaxDrift).toBeLessThanOrEqual(0.05);
    expect(r.seeks).toBeLessThanOrEqual(5);
  });

  it('a small drift is closed by rate nudging without any seek', () => {
    const el = new FakeEl(800);
    el.currentTime = -0.2; // starts 0.2 s behind
    const r = simulatePlanner(el, 15);
    expect(r.seeks).toBe(0);
    expect(r.tailMaxDrift).toBeLessThanOrEqual(0.05);
  });

  it('keeps the nudge window narrower than a full second', () => {
    expect(NUDGE_WINDOW_S).toBeLessThan(1);
  });
});

describe('upcomingClips (warm the next clip)', () => {
  const c = (clipId: string, timelineStart: number) => ({ clipId, trackId: 'v1', timelineStart });
  it('returns clips starting within the lookahead, soonest first', () => {
    const got = upcomingClips([c('late', 9), c('b', 11.5), c('a', 10.5), c('now', 10), c('far', 13)], 10, 2);
    expect(got.map((x) => x.clipId)).toEqual(['a', 'b']);
  });
});

describe('masterClockStep (audio is the master clock)', () => {
  const cases: Array<[string, number | null, number | null, number, number, number | null]> = [
    ['no audio context → rAF delta', null, null, 0.016, 0.016, null],
    ['first audio reading → rAF delta, clock primed', null, 5, 0.016, 0.016, 5],
    ['running audio → audio delta, not rAF', 5, 5.02, 0.016, 0.02, 5.02],
    ['a long rAF gap still follows the audio clock', 5, 5.25, 0.25, 0.25, 5.25],
    ['audio clock went backwards → rAF delta', 5, 4, 0.016, 0.016, 4],
    ['timestamp jitter a hair backwards → hold, keep the later clock', 5, 4.99, 0.016, 0, 5],
    ['audio clock frozen across a long frame → rAF delta', 5, 5, 0.2, 0.2, 5],
    ['audio clock not ticked within one short frame → 0', 5, 5, 0.016, 0, 5],
    ['implausible audio jump (device change) → rAF delta', 5, 9, 0.016, 0.016, 9],
    ['negative rAF delta is ignored', null, null, -1, 0, null],
  ];
  for (const [name, prev, now, raf, dt, audioOut] of cases) {
    it(name, () => {
      const r = masterClockStep(prev, now, raf);
      expect(r.dt).toBeCloseTo(dt, 9);
      expect(r.audio).toBe(audioOut);
    });
  }

  it('a src load is not a latency sample', () => {
    let s = noteSeekIssued(createSlotSync(), 0, false);
    const r = planSync(s, input({ nowMs: 5000 }));
    expect(r.latencySampleMs).toBeUndefined();
    s = r.state;
    expect(s.awaitingLanding).toBe(false);
  });
});
