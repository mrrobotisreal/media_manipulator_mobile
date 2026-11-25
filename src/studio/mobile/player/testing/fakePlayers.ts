/**
 * Test doubles for the Darkroom preview's decode path (ticket MA62 S1): fake `createVideoPlayer()`
 * players with the behaviours MA59 measured on the S25, and a simulated device loop that runs the
 * real UI-runtime pump at 60 Hz and the JS driver on its 100 ms timer.
 *
 * Fake player behaviour (all times simulated):
 * - a seek lands after `seekLatencyMs`; while paused, the first frame after a seek shows content
 *   `overshootFrames` past the target when `overshoot` says so (Android MediaPlayer, MA59), and a
 *   second identical seek lands exactly;
 * - playing, media time advances at `rate` (1, or a deliberate drift like 1.01) and a frame is
 *   decoded every 1 / fps; `copyLatestFrame()` returns only the newest undelivered frame;
 * - `broken`: metadata never loads and no frame ever comes (a corrupt file: no error event);
 * - `missing`: the factory throws, like `createVideoPlayer` for a file it cannot open.
 */
import { createPumpState, pumpFrame, type FrameSink, type PumpState } from '../framePump';
import { idleControl, type ClockControl, type PumpFeedback, type PumpSink, type SlotControl } from '../slotControl';
import { SLOT_COUNT, type PreviewFrame, type PreviewPlayer } from '../types';

export interface FakeFrame extends PreviewFrame {
  /** The media time the frame shows (the barcode MA59 read back). */
  readonly content: number;
  released: boolean;
}

export interface FakeMediaSpec {
  duration: number;
  fps?: number;
  broken?: boolean;
  missing?: boolean;
  /** Drift: media seconds per real second while playing. */
  rate?: number;
  seekLatencyMs?: number;
  /** Paused seek overshoot: called per seek, true = this one lands `overshootFrames` late. */
  overshoot?: (seekIndex: number) => boolean;
  overshootFrames?: number;
}

export class FakePlayer implements PreviewPlayer {
  paused = true;
  volume = 1;
  loop = true;
  released = false;
  readonly rotation = 0 as const;
  readonly seeks: number[] = [];
  readonly frames: FakeFrame[] = [];
  private media: number = 0;
  private pendingSeek: { to: number; atMs: number; overshoot: boolean } | null = null;
  private latest: FakeFrame | null = null;
  private sinceFrameMs = 0;
  private nowMs = 0;

  constructor(
    readonly uri: string,
    private readonly spec: FakeMediaSpec,
  ) {}

  get fps(): number {
    return this.spec.fps ?? 30;
  }
  get duration(): number {
    return this.spec.broken ? 0 : this.spec.duration;
  }
  get videoWidth(): number {
    return this.spec.broken ? 0 : 1280;
  }
  get videoHeight(): number {
    return this.spec.broken ? 0 : 720;
  }
  get frameRate(): number {
    return this.spec.broken ? 0 : this.fps;
  }
  get currentTime(): number {
    // currentTime reads the target at once, even while the frame is late (MA59).
    return this.pendingSeek ? this.pendingSeek.to : this.media;
  }
  set currentTime(v: number) {
    if (this.released) return;
    const to = Math.max(0, Math.min(v, this.spec.duration));
    const i = this.seeks.length;
    this.seeks.push(to);
    const over = this.paused && (this.spec.overshoot?.(i) ?? false);
    this.pendingSeek = { to, atMs: this.nowMs, overshoot: over };
  }

  play(): void {
    if (!this.released) this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  release(): void {
    this.released = true;
    this.paused = true;
  }

  copyLatestFrame(): PreviewFrame | null {
    if (this.released || !this.latest) return null;
    const f = this.latest;
    this.latest = null;
    return f;
  }

  /** Advance simulated time. */
  advance(nowMs: number): void {
    const dt = nowMs - this.nowMs;
    this.nowMs = nowMs;
    if (this.released || this.spec.broken) return;
    const lat = this.spec.seekLatencyMs ?? 60;
    if (this.pendingSeek && nowMs - this.pendingSeek.atMs >= lat) {
      const s = this.pendingSeek;
      this.pendingSeek = null;
      this.media = s.to;
      const shown = s.overshoot ? s.to + (this.spec.overshootFrames ?? 19) / this.fps : s.to;
      this.emit(shown);
      this.sinceFrameMs = 0;
      return;
    }
    if (!this.paused && !this.pendingSeek) {
      this.media = Math.min(this.spec.duration, this.media + (dt / 1000) * (this.spec.rate ?? 1));
      this.sinceFrameMs += dt;
      if (this.sinceFrameMs >= 1000 / this.fps) {
        this.sinceFrameMs %= 1000 / this.fps;
        this.emit(this.media);
      }
    }
  }

  private emit(content: number): void {
    // An undelivered frame is dropped (acquireLatestImage keeps the newest).
    if (this.latest) this.latest.released = true;
    const f: FakeFrame = {
      width: 1280,
      height: 720,
      content,
      released: false,
      release() {
        this.released = true;
      },
    };
    this.frames.push(f);
    this.latest = f;
  }
}

/** A factory over named fake media (`uri` = the key the test's `PoolMedia` returns). */
export function fakeFactory(media: Record<string, FakeMediaSpec>) {
  const made: FakePlayer[] = [];
  const factory = (uri: string): PreviewPlayer => {
    const spec = media[uri];
    if (!spec || spec.missing) throw new Error(`createVideoPlayer: cannot open ${uri}`);
    const p = new FakePlayer(uri, spec);
    made.push(p);
    return p;
  };
  return { factory, made, live: () => made.filter((p) => !p.released) };
}

/** A frame sink that records what the pump copied and releases every frame. */
export function recordingSink() {
  const shown: (number | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
  const sink: FrameSink = {
    copy(slot, frame) {
      shown[slot] = (frame as FakeFrame).content;
      frame.release();
      return true;
    },
  };
  return { sink, shown };
}

/**
 * The bridge the app builds from shared values, as plain objects: what the JS side publishes is
 * what the pump reads on the next frame, and the pump's outputs are what the JS side reads.
 */
export function memoryBridge() {
  const controls: SlotControl[] = Array.from({ length: SLOT_COUNT }, () => idleControl());
  let players: (PreviewPlayer | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
  let clock: ClockControl = { seq: 0, playing: 0, t0: 0, frameMs: 1000 / 30 };
  const state: PumpState = createPumpState();
  const sink: PumpSink = {
    setControl(slot, c) {
      controls[slot] = c;
    },
    setPlayers(p) {
      players = p.slice() as (PreviewPlayer | null)[];
    },
    setClock(c) {
      clock = c;
    },
  };
  const feedback: PumpFeedback = {
    frames: (i) => state.frames[i]!,
    landedSeq: (i) => state.landedSeq[i]!,
    latencyMs: (i) => state.latencyMs[i]!,
  };
  return {
    sink,
    feedback,
    state,
    controls,
    get players() {
      return players;
    },
    get clock() {
      return clock;
    },
    pump(frameSink: FrameSink, nowMs: number) {
      pumpFrame(state, controls, players, clock, frameSink, nowMs);
    },
  };
}
