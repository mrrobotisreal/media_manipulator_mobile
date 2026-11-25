/**
 * Preview audio on the phone (ticket MA62 decision 5): every player's `volume`, set on each clock
 * tick (~100 ms) from the copied mixer math, exactly the web's no-Web-Audio fallback
 * (preview-surface.tsx `routeSlotAudio`'s element branch):
 *
 *   volume = fallbackElementVolume(clipGain, track.gain, master)   (capped at 1: a player cannot boost)
 *   clipGain = clipValuesAt(clip).volume (flat / keyframed)  x  audioFadeGain (equal-power crossfade)
 *   0 when the track is not audible (`isTrackAudible`: mute / solo) or the clip is stalled
 *
 * "Stalled" on the phone = a slot that does not play at its own rate (frame-stepped speed, a freeze,
 * a reverse still building): `speedPolicy.ts` marks it muted (decision 0). Slots that are not the
 * playhead's (pre-roll, retained) are silent.
 *
 * Not previewed in phase 1 (DARKROOM_MOBILE.md §5): track EQ, compressor, pan and ducking. The
 * mixer UI reads `PREVIEW_AUDIO_NOTE` to say so. Fades follow the 100 ms tick, not per sample.
 */
import { fallbackElementVolume, masterGainOf } from '../../mixerMath';
import { audioFadeGain, clipValuesAt } from '../../previewEngine';
import type { StudioAudioConfig, StudioClip, StudioTrack } from '../../studioTypes';
import { anySolo, isTrackAudible } from '../../trackAudibility';

/** Tells the mixer sheet that EQ, compressor, pan and ducking are export-only in this preview. */
export const PREVIEW_AUDIO_NOTE = true;

/** A volume change smaller than this is not written to the player. */
export const VOLUME_EPSILON = 0.002;

export interface VolumeSlot {
  clip: StudioClip | null;
  trackId: string | null;
  /** The slot plays the playhead's clip (not pre-roll / retained). */
  active: boolean;
  /** The slot does not play at its own rate (stepped, held): silent. */
  stalled: boolean;
}

export interface MixContext {
  tracks: readonly StudioTrack[];
  audio: StudioAudioConfig | undefined;
  t: number;
}

/** The volume one slot should have now (0..1). */
export function slotVolume(s: VolumeSlot, ctx: MixContext, soloOn = anySolo(ctx.tracks as StudioTrack[])): number {
  if (!s.active || !s.clip || !s.trackId || s.stalled) return 0;
  const track = ctx.tracks.find((tr) => tr.id === s.trackId);
  if (!track || !isTrackAudible(track as StudioTrack, soloOn)) return 0;
  const vals = clipValuesAt(s.clip, ctx.t - s.clip.timelineStart);
  const gainNow = vals.volume * audioFadeGain(s.clip, track.clips, ctx.t);
  return fallbackElementVolume(gainNow, track.gain, masterGainOf(ctx.audio));
}

/** The volumes of every slot (same order). */
export function slotVolumes(slots: readonly VolumeSlot[], ctx: MixContext): number[] {
  const soloOn = anySolo(ctx.tracks as StudioTrack[]);
  return slots.map((s) => slotVolume(s, ctx, soloOn));
}

/** Writes `volume` to a player only when it moved by more than `VOLUME_EPSILON`. */
export function applyVolume(player: { volume: number }, volume: number): boolean {
  if (Math.abs(player.volume - volume) <= VOLUME_EPSILON && !(volume === 0 && player.volume !== 0))
    return false;
  player.volume = volume;
  return true;
}
