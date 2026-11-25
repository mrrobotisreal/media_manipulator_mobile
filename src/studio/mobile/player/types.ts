/**
 * The decoder seam of the Darkroom preview (ticket MA62 decisions 3–5).
 *
 * `PreviewPlayer` is the part of `react-native-webgpu` 0.22.0's `VideoPlayer` the preview uses
 * (read in `node_modules/react-native-webgpu/src/types.ts` and `cpp/rnwgpu/api/VideoPlayer.h`):
 * play / pause / release, an assignable `currentTime` (a seek, also while paused), `volume` 0..1,
 * `loop`, the metadata getters and `copyLatestFrame()`. What 0.22.0 does NOT have, and what this
 * module therefore never assumes:
 * - no playback rate (no `playbackRate`, no `setPlaybackParams` on Android): speed is frame-stepped
 *   (`speedPolicy.ts`), drift is corrected by seeking only (`Clock.ts`);
 * - no presentation timestamp on a frame (`NativeVideoFrame` has `handle`, `width`, `height`,
 *   `pixelFormat`, `acquireFenceFd`, `release()`): a presented frame cannot be checked against its
 *   target, so sync is clock-accurate, not provably frame-accurate (MA76);
 * - no error event (Android's `OnErrorListener` only logs and stops): a slot that yields no frame
 *   within 3 s is failed (`VideoPool.ts`). A missing file throws from the factory.
 *
 * Production passes `createVideoPlayer`; the jest suites pass fake players.
 */

/** A decoded frame handle (`NativeVideoFrame`): released by its consumer right after the copy. */
export interface PreviewFrame {
  readonly width: number;
  readonly height: number;
  release(): void;
}

export interface PreviewPlayer {
  copyLatestFrame(): PreviewFrame | null;
  play(): void;
  pause(): void;
  release(): void;
  readonly paused: boolean;
  /** Seconds; assigning seeks (`MediaPlayer.seekTo(SEEK_CLOSEST)` on Android). */
  currentTime: number;
  /** Seconds, 0 until the metadata loaded (and forever for a file it cannot read). */
  readonly duration: number;
  /** 0..1. */
  volume: number;
  /** Defaults to true in react-native-webgpu: the pool sets it false. */
  loop: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly frameRate: number;
}

/** `createVideoPlayer(uri)`; throws when the file cannot be opened. */
export type PlayerFactory = (uri: string) => PreviewPlayer;

/** The pool size: the web's `POOL_SIZE` (preview-surface.tsx). */
export const SLOT_COUNT = 4;
