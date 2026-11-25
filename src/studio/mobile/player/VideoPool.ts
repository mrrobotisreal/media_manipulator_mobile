/**
 * The Darkroom preview's decoder slots (ticket MA62 decision 3, with the decision 0 rules).
 *
 * Up to `SLOT_COUNT` (4, the web's pool size) players, each holding one clip's source. Run on the
 * JS thread from the preview's ~100 ms timer, never per frame:
 *
 * - **assignment** (the web's MM70 choice, preview-surface.tsx `syncFrame`): a clip keeps its own
 *   slot; else a free slot already holding the same source (a split clip, a cut back to the same
 *   file: no reload); else a free slot; else a retained one (farthest from the playhead first); an
 *   active clip may also take a pre-roll slot. Active clips rank top-most visible video first, then
 *   audio, then hidden video (decoded for sound only); with 4 slots taken by active clips the next
 *   one is skipped, as on the web.
 * - **pre-roll**: while playing, the next clip on each track that starts within 2 s (the copied
 *   `upcomingClips` / `WARM_LOOKAHEAD_S`) is loaded paused and silent and seeked to its first
 *   frame; the frame pump starts it on the frame its clip begins (`SlotControl.startAtT`).
 * - **retention**: a slot whose clip is no longer wanted keeps its player while the clip is inside
 *   ±10 s of the playhead (a scrub back is then instant) and releases it outside that window.
 * - **source**: the clip's proxy, the reversed proxy for a reversed clip whose reversed proxy is
 *   ready, or MA61's local file when eligible (`PoolMedia.info` decides; the pool only sees a URI).
 *   Speed has no player rate in react-native-webgpu 0.22.0: `speedPolicy.ts`.
 * - **failure**: there is no error event. A video slot that is expected to produce a frame (after a
 *   load or seek, or while its clip plays) and yields none for 3 s is failed: its player is
 *   released, its source is not retried until `clearFailures()`, and the compositor shows the
 *   sprite tile (`slotOf(clipId).failed`). A factory throw (missing file) fails at once.
 *
 * Frames themselves never pass through here: the UI-runtime pump copies and releases them
 * (`framePump.ts`).
 */
import { clipEnd, resolveActiveClips, type ActiveClip } from '../../previewEngine';
import { upcomingClips, WARM_LOOKAHEAD_S } from '../../playbackSync';
import { sourceTimeAt } from '../../speed';
import type { StudioClip, StudioTrack } from '../../studioTypes';
import {
  FAR_FUTURE,
  KIND_AUDIO,
  KIND_VIDEO,
  MODE_HOLD,
  MODE_PLAY,
  MODE_STEP,
  idleControl,
  type PumpFeedback,
  type PumpSink,
  type SlotControl,
} from './slotControl';
import { clipPlayback, playbackTarget, type ClipPlayback } from './speedPolicy';
import { SLOT_COUNT, type PlayerFactory, type PreviewPlayer } from './types';

/** Pre-roll lead (s): the web's warm-up window. */
export const PREROLL_S = WARM_LOOKAHEAD_S;
/** Players whose clip is outside ±this (s) of the playhead are released. */
export const RETAIN_WINDOW_S = 10;
/** No frame for this long while one is expected: the slot is failed. */
export const NO_FRAME_TIMEOUT_MS = 3000;

/** What the pool needs to know about a clip's media; null = nothing to decode (title, image, ingesting). */
export interface PoolMediaInfo {
  kind: 'video' | 'audio';
  /** The source's duration (the reversed proxy mirrors it). */
  durationSeconds: number;
  /** The copied `reverseProxyReady(entry)`. */
  reverseReady: boolean;
  /** Frame rate of the source when known (half a frame is the step dead band). */
  fps?: number;
  /** A stable key per decodable file: the copied `proxySrcKey(assetId, generation, reversed)`. */
  key(reversed: boolean): string;
  /** The file the player opens, or null while it is not available on the phone yet. */
  uri(reversed: boolean): string | null;
}

export interface PoolMedia {
  info(clip: StudioClip): PoolMediaInfo | null;
}

export type SlotRole = 'free' | 'active' | 'preroll' | 'retained';

/** The JS-side record of one slot (read by the clock, volumes and the compositor). */
export interface SlotState {
  readonly index: number;
  role: SlotRole;
  clipId: string | null;
  trackId: string | null;
  clip: StudioClip | null;
  player: PreviewPlayer | null;
  /** The source the player holds (kept on a free slot for reuse). */
  key: string | null;
  kind: 'video' | 'audio' | null;
  playback: ClipPlayback | null;
  failed: boolean;
  /** The control last published to the pump. */
  control: SlotControl;
  /** Feedback bookkeeping. */
  lastFrames: number;
  expectSinceMs: number | null;
}

export interface PoolUpdate {
  tracks: readonly StudioTrack[];
  t: number;
  playing: boolean;
  nowMs: number;
}

export interface VideoPoolDeps {
  factory: PlayerFactory;
  media: PoolMedia;
  sink: PumpSink;
  feedback: PumpFeedback;
  /** Project fps (step cadence fallback). */
  fps: number;
}

const modeNumber = (p: ClipPlayback) =>
  p.mode === 'play' ? MODE_PLAY : p.mode === 'step' ? MODE_STEP : MODE_HOLD;

interface Wanted {
  active: ActiveClip | null;
  clip: StudioClip;
  trackId: string;
  info: PoolMediaInfo;
  rank: number;
}

function rankActive(a: ActiveClip, hidden: boolean): number {
  if (a.trackKind === 'video' && !hidden) return 1000 + a.trackIndex; // top-most (highest index) first
  if (a.trackKind === 'audio') return 500 - a.trackIndex; // A1 first
  return 100 + a.trackIndex; // hidden video: sound only
}

export class VideoPool {
  readonly slots: SlotState[];
  private failedKeys = new Set<string>();
  private playersPublished: (PreviewPlayer | null)[] = [];
  private gen = 0;

  constructor(private readonly deps: VideoPoolDeps) {
    this.slots = Array.from({ length: SLOT_COUNT }, (_, index) => ({
      index,
      role: 'free' as SlotRole,
      clipId: null,
      trackId: null,
      clip: null,
      player: null,
      key: null,
      kind: null,
      playback: null,
      failed: false,
      control: idleControl(),
      lastFrames: 0,
      expectSinceMs: null,
    }));
    this.publishPlayers();
  }

  slotOf(clipId: string): SlotState | undefined {
    return this.slots.find((s) => s.clipId === clipId);
  }

  /** Forget failures (a proxy rebuild, a retry button): the next update reloads those sources. */
  clearFailures(): void {
    this.failedKeys.clear();
  }

  /** Reconcile the slots to the timeline at `t`. */
  update(u: PoolUpdate): void {
    const wanted = this.wanted(u);
    const wantedIds = new Set(wanted.map((w) => w.clip.id));

    // 1. Slots whose clip is no longer wanted: retain inside ±10 s, otherwise free (player released).
    for (const s of this.slots) {
      if (!s.clipId || wantedIds.has(s.clipId)) continue;
      if (s.clip && this.inRetainWindow(s.clip, u.t) && s.player && !s.failed) {
        if (s.role !== 'retained') {
          s.role = 'retained';
          this.publish(s, { ...s.control, startAtT: FAR_FUTURE, stopAtT: FAR_FUTURE });
        }
      } else {
        this.free(s, true);
      }
    }

    // 2. Assign the wanted clips in priority order.
    for (const w of wanted) this.assign(w, u);

    // 3. Retained slots that drift out of the window release their player.
    for (const s of this.slots) {
      if (s.role === 'retained' && s.clip && !this.inRetainWindow(s.clip, u.t)) this.free(s, true);
    }

    this.checkFrames(u);
    this.publishPlayers();
  }

  /** Issue a seek through the pump (`exact`: a paused seek, which gets the landing re-seek). */
  requestSeek(s: SlotState, to: number, exact: boolean, nowMs: number): void {
    if (!s.player) return;
    this.publish(s, {
      ...s.control,
      seekSeq: s.control.seekSeq + 1,
      seekTo: Math.max(0, to),
      seekExact: exact ? 1 : 0,
    });
    if (s.kind === 'video') s.expectSinceMs = s.expectSinceMs ?? nowMs;
  }

  /** A seek is in flight (issued and its first frame not yet arrived). */
  seekPending(s: SlotState): boolean {
    return s.kind === 'video' && this.deps.feedback.landedSeq(s.index) !== s.control.seekSeq;
  }

  /** Release every player (the preview unmounted or went to safe mode). */
  releaseAll(): void {
    for (const s of this.slots) this.free(s, true);
    this.publishPlayers();
  }

  // -------------------------------------------------------------------------

  private wanted(u: PoolUpdate): Wanted[] {
    const hidden = new Set(u.tracks.filter((tr) => tr.kind === 'video' && tr.hidden).map((tr) => tr.id));
    const out: Wanted[] = [];
    for (const a of resolveActiveClips(u.tracks as StudioTrack[], u.t)) {
      if (a.clip.title) continue;
      const info = this.deps.media.info(a.clip);
      if (!info) continue;
      out.push({ active: a, clip: a.clip, trackId: a.trackId, info, rank: rankActive(a, hidden.has(a.trackId)) });
    }
    if (u.playing) {
      const candidates: { clipId: string; trackId: string; timelineStart: number; clip: StudioClip }[] = [];
      for (const tr of u.tracks) {
        for (const c of tr.clips) {
          if (c.timelineStart > u.t && c.timelineStart <= u.t + PREROLL_S && !c.title) {
            candidates.push({ clipId: c.id, trackId: tr.id, timelineStart: c.timelineStart, clip: c });
          }
        }
      }
      const seenTracks = new Set<string>();
      for (const n of upcomingClips(candidates, u.t, PREROLL_S)) {
        if (seenTracks.has(n.trackId)) continue; // the next clip on each track
        seenTracks.add(n.trackId);
        const info = this.deps.media.info(n.clip);
        if (!info) continue;
        out.push({ active: null, clip: n.clip, trackId: n.trackId, info, rank: -n.timelineStart });
      }
    }
    // Active before pre-roll; within each, by rank (pre-roll: soonest first).
    out.sort((x, y) => (y.active ? 1 : 0) - (x.active ? 1 : 0) || y.rank - x.rank);
    return out;
  }

  private inRetainWindow(c: StudioClip, t: number): boolean {
    return clipEnd(c) >= t - RETAIN_WINDOW_S && c.timelineStart <= t + RETAIN_WINDOW_S;
  }

  private pickSlot(w: Wanted, key: string, t: number): SlotState | undefined {
    const own = this.slots.find((s) => s.clipId === w.clip.id);
    if (own) return own;
    const free = this.slots.filter((s) => s.role === 'free');
    const sameSource =
      free.find((s) => s.key === key && s.player) ??
      this.slots.find((s) => s.role === 'retained' && s.key === key && s.player);
    if (sameSource) return sameSource;
    if (free.length) return free.find((s) => !s.player) ?? free[0];
    const retained = this.slots
      .filter((s) => s.role === 'retained')
      .sort((a, b) => distance(b.clip!, t) - distance(a.clip!, t));
    if (retained.length) return retained[0];
    if (w.active) {
      const preroll = this.slots.filter((s) => s.role === 'preroll');
      // The pre-roll that starts last gives way first.
      preroll.sort((a, b) => b.clip!.timelineStart - a.clip!.timelineStart);
      if (preroll.length) return preroll[0];
    }
    return undefined;
  }

  private assign(w: Wanted, u: PoolUpdate): void {
    const playback = clipPlayback(w.clip, w.info.reverseReady, w.info.durationSeconds);
    const key = w.info.key(playback.reversedSource);
    const s = this.pickSlot(w, key, u.t);
    if (!s) return; // pool exhausted: skipped, as on the web
    const role: SlotRole = w.active ? 'active' : 'preroll';
    const newClip = s.clipId !== w.clip.id;

    if (s.failed && s.clipId === w.clip.id && s.key === key && this.failedKeys.has(key)) {
      s.role = role;
      s.clip = w.clip;
      return; // stays failed (sprite tile) until clearFailures()
    }
    if (this.failedKeys.has(key)) {
      if (s.clipId !== w.clip.id) this.free(s, s.key !== key);
      this.bindFailed(s, w, key, role);
      return;
    }

    let loaded = false;
    if (s.key !== key || !s.player) {
      const uri = w.info.uri(playback.reversedSource);
      if (!uri) {
        // Not on the phone yet (download in flight): nothing to decode this tick.
        if (newClip) this.free(s, s.key !== key);
        return;
      }
      this.releasePlayer(s);
      try {
        const p = this.deps.factory(uri);
        p.loop = false;
        p.volume = 0;
        s.player = p;
        s.key = key;
        s.kind = w.info.kind;
        loaded = true;
      } catch {
        // createVideoPlayer throws synchronously for a file it cannot open (MA59).
        this.failedKeys.add(key);
        this.bindFailed(s, w, key, role);
        return;
      }
    }

    const fps = w.info.fps && w.info.fps > 0 ? w.info.fps : this.deps.fps;
    const control: SlotControl = {
      ...s.control,
      gen: loaded ? ++this.gen : s.control.gen,
      kind: s.kind === 'audio' ? KIND_AUDIO : KIND_VIDEO,
      mode: modeNumber(playback),
      a: playback.a,
      b: playback.b,
      lo: playback.lo,
      hi: playback.hi,
      startAtT: w.clip.timelineStart,
      stopAtT: clipEnd(w.clip),
      stepMinDelta: 0.5 / fps,
    };
    s.role = role;
    s.clipId = w.clip.id;
    s.trackId = w.trackId;
    s.clip = w.clip;
    s.playback = playback;
    s.failed = false;
    if (loaded) {
      s.lastFrames = this.deps.feedback.frames(s.index);
      s.expectSinceMs = s.kind === 'video' ? u.nowMs : null;
    }
    const changed = !sameControl(control, s.control);
    if (changed) this.publish(s, control);

    // A fresh load or a newly bound clip starts at its position: the clip's first frame for a
    // pre-roll, the playhead's source position for an active clip (exact while paused).
    if (loaded || newClip) {
      const at = w.active
        ? playbackTarget(playback, u.t)
        : playbackTarget(playback, w.clip.timelineStart);
      this.requestSeek(s, at, !u.playing || !w.active, u.nowMs);
    }
  }

  private bindFailed(s: SlotState, w: Wanted, key: string, role: SlotRole): void {
    this.releasePlayer(s);
    s.role = role;
    s.clipId = w.clip.id;
    s.trackId = w.trackId;
    s.clip = w.clip;
    s.key = key;
    s.kind = w.info.kind;
    s.playback = null;
    s.failed = true;
    s.expectSinceMs = null;
    this.publish(s, idleControl(++this.gen));
  }

  private checkFrames(u: PoolUpdate): void {
    for (const s of this.slots) {
      if (!s.player || s.kind !== 'video' || s.failed) continue;
      const frames = this.deps.feedback.frames(s.index);
      const runs =
        u.playing &&
        s.role === 'active' &&
        s.control.mode !== MODE_HOLD &&
        u.t >= s.control.startAtT &&
        u.t < s.control.stopAtT;
      const expecting = this.seekPending(s) || runs;
      if (frames !== s.lastFrames) {
        s.lastFrames = frames;
        s.expectSinceMs = expecting ? u.nowMs : null;
        continue;
      }
      if (!expecting) {
        s.expectSinceMs = null;
        continue;
      }
      if (s.expectSinceMs === null) s.expectSinceMs = u.nowMs;
      else if (u.nowMs - s.expectSinceMs >= NO_FRAME_TIMEOUT_MS) {
        if (s.key) this.failedKeys.add(s.key);
        this.releasePlayer(s);
        s.failed = true;
        s.expectSinceMs = null;
        this.publish(s, idleControl(++this.gen));
      }
    }
  }

  private releasePlayer(s: SlotState): void {
    if (s.player) {
      try {
        s.player.pause();
        s.player.release();
      } catch {
        // already released
      }
    }
    s.player = null;
  }

  /** Unbind the slot's clip; `dropPlayer`: also release the player (else it stays for source reuse). */
  private free(s: SlotState, dropPlayer: boolean): void {
    if (dropPlayer) {
      this.releasePlayer(s);
      s.key = null;
      s.kind = null;
    } else if (s.player) {
      try {
        s.player.pause();
        s.player.volume = 0;
      } catch {
        // released underneath
      }
    }
    s.role = 'free';
    s.clipId = null;
    s.trackId = null;
    s.clip = null;
    s.playback = null;
    s.failed = false;
    s.expectSinceMs = null;
    this.publish(
      s,
      dropPlayer
        ? idleControl(++this.gen)
        : { ...s.control, startAtT: FAR_FUTURE, stopAtT: FAR_FUTURE },
    );
  }

  private publish(s: SlotState, control: SlotControl): void {
    s.control = control;
    this.deps.sink.setControl(s.index, control);
  }

  private publishPlayers(): void {
    const next = this.slots.map((s) => s.player);
    if (next.every((p, i) => p === this.playersPublished[i]) && next.length === this.playersPublished.length) return;
    this.playersPublished = next;
    this.deps.sink.setPlayers(next);
  }
}

function distance(c: StudioClip, t: number): number {
  if (t < c.timelineStart) return c.timelineStart - t;
  const e = clipEnd(c);
  return t > e ? t - e : 0;
}

function sameControl(a: SlotControl, b: SlotControl): boolean {
  return (
    a.gen === b.gen &&
    a.kind === b.kind &&
    a.mode === b.mode &&
    a.a === b.a &&
    a.b === b.b &&
    a.lo === b.lo &&
    a.hi === b.hi &&
    a.startAtT === b.startAtT &&
    a.stopAtT === b.stopAtT &&
    a.stepMinDelta === b.stepMinDelta
  );
}

/** The clip's source position at its first frame (the compositor's sprite tile for a failed slot). */
export const firstSourceTime = (c: StudioClip): number => sourceTimeAt(c, c.timelineStart);
