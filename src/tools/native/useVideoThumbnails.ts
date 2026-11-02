import type { VideoPlayer, VideoThumbnail } from 'expo-video';
import { useEffect, useState } from 'react';

export const THUMB_MAX_WIDTH = 160;
export const THUMB_MIN = 6;
export const THUMB_MAX = 12;
const CELL_W = 48;

/** `count = clamp(round(trackWidth / 48), 6, 12)` (MA18 decision 6). */
export function thumbCount(trackWidth: number): number {
  const n = Math.round((Number.isFinite(trackWidth) ? trackWidth : 0) / CELL_W);
  return Math.min(THUMB_MAX, Math.max(THUMB_MIN, n));
}

/** Mid-points of `count` equal slices, so the first and last cell never sit on a black first/last frame. */
export function thumbTimes(duration: number, count: number): number[] {
  if (!(duration > 0)) return [];
  return Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration);
}

export interface ThumbState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  thumbs: VideoThumbnail[];
}

/**
 * `player.generateThumbnailsAsync(times, { maxWidth: 160 })` (expo-video 57, no extra package), once per
 * `(player, count)` after the duration is known; cancelled on unmount. Never throws: a failure leaves the
 * plain track (the scrubber still works).
 */
export function useVideoThumbnails(
  player: VideoPlayer | null,
  duration: number | undefined,
  count: number,
): ThumbState {
  const [done, setDone] = useState<{ key: string; state: ThumbState } | null>(null);
  const key = `${duration ?? 0}:${count}`;
  useEffect(() => {
    if (!player || !duration || duration <= 0) return;
    let cancelled = false;
    player
      .generateThumbnailsAsync(thumbTimes(duration, count), { maxWidth: THUMB_MAX_WIDTH })
      .then((thumbs) => {
        if (!cancelled) setDone({ key, state: { status: 'ready', thumbs } });
      })
      .catch(() => {
        if (!cancelled) setDone({ key, state: { status: 'error', thumbs: [] } });
      });
    return () => {
      cancelled = true;
    };
  }, [player, duration, count, key]);
  if (!player || !duration) return { status: 'idle', thumbs: [] };
  return done?.key === key ? done.state : { status: 'loading', thumbs: [] };
}

/** One frame (crop editor background) at `time`; null until generated or on failure. */
export function useVideoFrame(
  player: VideoPlayer | null,
  duration: number | undefined,
  time: number,
): VideoThumbnail | null {
  const [frame, setFrame] = useState<VideoThumbnail | null>(null);
  useEffect(() => {
    if (!player || !duration || duration <= 0) return;
    let cancelled = false;
    player
      .generateThumbnailsAsync([Math.min(time, Math.max(0, duration - 0.05))], { maxWidth: 1080 })
      .then((t) => {
        if (!cancelled) setFrame(t[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [player, duration, time]);
  return frame;
}
