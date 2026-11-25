/**
 * A simulated device for the Darkroom preview tests: a 60 Hz UI-runtime frame loop running the real
 * pump, the fake players' decoders, and the JS driver's 100 ms timer, on one virtual clock.
 */
import type { StudioClip, StudioTrack } from '../../../studioTypes';
import { PreviewDriver, TICK_MS, type DriverDoc } from '../PreviewDriver';
import type { PoolMedia, PoolMediaInfo } from '../VideoPool';
import { fakeFactory, memoryBridge, recordingSink, type FakeMediaSpec } from './fakePlayers';

export const FRAME_MS = 1000 / 60;

export function clip(over: Partial<StudioClip> & { id: string; timelineStart: number }): StudioClip {
  return {
    assetId: 'a1',
    streamIndex: 0,
    sourceIn: 0,
    sourceOut: 10,
    ...over,
  } as StudioClip;
}

export function lane(
  id: string,
  index: number,
  clips: StudioClip[],
  over: Partial<StudioTrack> = {},
): StudioTrack {
  return { id, kind: 'video', index, muted: false, clips, ...over } as StudioTrack;
}

export interface SimAsset {
  kind?: 'video' | 'audio';
  duration?: number;
  reverseReady?: boolean;
  /** No file on the phone yet. */
  noUri?: boolean;
}

/** `PoolMedia` over `assetId` -> spec; uri = key = `assetId` (+ ':r' reversed). */
export function simMedia(assets: Record<string, SimAsset>): PoolMedia {
  return {
    info(c: StudioClip): PoolMediaInfo | null {
      const a = assets[c.assetId];
      if (!a) return null;
      return {
        kind: a.kind ?? 'video',
        durationSeconds: a.duration ?? 60,
        reverseReady: a.reverseReady ?? false,
        fps: 30,
        key: (r) => `${c.assetId}${r ? ':r' : ''}`,
        uri: (r) => (a.noUri ? null : `${c.assetId}${r ? ':r' : ''}`),
      };
    },
  };
}

export function createSim(opts: {
  doc: DriverDoc;
  assets: Record<string, SimAsset>;
  media: Record<string, FakeMediaSpec>;
  t?: number;
}) {
  const fakes = fakeFactory(opts.media);
  const bridge = memoryBridge();
  const rec = recordingSink();
  const driver = new PreviewDriver(
    {
      factory: fakes.factory,
      media: simMedia(opts.assets),
      sink: bridge.sink,
      feedback: bridge.feedback,
      fps: opts.doc.fps,
    },
    opts.doc,
    opts.t ?? 0,
  );
  let now = 0;
  let nextTick = TICK_MS;
  const frame = () => {
    now += FRAME_MS;
    for (const p of fakes.made) p.advance(now);
    bridge.pump(rec.sink, now);
    if (now >= nextTick) {
      nextTick += TICK_MS;
      driver.tick(now);
    }
  };
  return {
    driver,
    fakes,
    bridge,
    shown: rec.shown,
    get now() {
      return now;
    },
    /** Run the loop for `ms` of simulated time. */
    run(ms: number) {
      const end = now + ms;
      while (now < end) frame();
    },
    /** Run until `cond()` or `maxMs`; returns the elapsed ms, or -1 on timeout. */
    until(cond: () => boolean, maxMs = 5000) {
      const start = now;
      while (now - start < maxMs) {
        if (cond()) return now - start;
        frame();
      }
      return cond() ? now - start : -1;
    },
    play() {
      driver.play(now);
    },
    pause() {
      driver.pause(now);
    },
    seek(t: number) {
      driver.seek(t, now);
    },
    /** The player of the slot holding `clipId`. */
    playerOf(clipId: string) {
      const s = driver.pool.slotOf(clipId);
      return s?.player ? fakes.made.find((p) => p === s.player) : undefined;
    },
  };
}
