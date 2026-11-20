// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/mixerMath.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioAsset, StudioClip, StudioTrack, StudioTrackEffects } from './studioTypes';
import { STUDIO_V3_RANGES } from './effectRegistry';
import { EQ_BANDS, TRACK_COMP_KNEE_DB } from './audioPresets';

/**
 * Audio mixer math (Darkroom v3 part 19) — pure, shared by the mixer UI, the
 * Web Audio preview graph and the element-volume fallback.
 *
 * COMPOSITION (preview == export): clip volume/pan -> track EQ -> compressor
 * -> track gain -> track pan -> ducking/mute/solo -> project master gain ->
 * (export only) loudnorm. Linear gains multiply, so clip x track x master.
 */

const { faderDb } = STUDIO_V3_RANGES;
/** Fader positions at/below this are the -inf detent (gain 0). */
const FADER_FLOOR_POS = 0.01;
const FADER_MAX_GAIN = STUDIO_V3_RANGES.trackGain.max;

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** Linear gain -> dB; non-positive gain is -Infinity. */
export const gainToDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

/** Fader position 0..1 (0 = bottom/-inf, 1 = top/+6 dB) -> linear gain 0..2 via the dB curve. */
export function faderPosToGain(pos: number): number {
  const p = Math.max(0, Math.min(1, pos));
  if (p <= FADER_FLOOR_POS) return 0;
  const db = faderDb.min + (faderDb.max - faderDb.min) * p;
  return Math.min(FADER_MAX_GAIN, dbToGain(db));
}

/** Linear gain -> fader position 0..1 (inverse of faderPosToGain). */
export function gainToFaderPos(gain: number): number {
  if (!(gain > 0)) return 0;
  const db = gainToDb(Math.min(gain, FADER_MAX_GAIN));
  if (db <= faderDb.min) return FADER_FLOOR_POS;
  return Math.max(FADER_FLOOR_POS, Math.min(1, (db - faderDb.min) / (faderDb.max - faderDb.min)));
}

/** "-inf", "-12.3", "+3.0" readout for a linear gain. */
export function formatDb(gain: number): string {
  const db = gainToDb(gain);
  if (!Number.isFinite(db) || db < faderDb.min) return '-inf';
  const r = Math.round(db * 10) / 10;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}`;
}

/** Peak (linear) of a time-domain buffer, converted to dBFS (floor -60). */
export function peakDb(buf: ArrayLike<number>, floorDb = -60): number {
  let peak = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = Math.abs(buf[i]);
    if (v > peak) peak = v;
  }
  return peak > 0 ? Math.max(floorDb, 20 * Math.log10(peak)) : floorDb;
}

/** Everything a track's Web Audio chain needs, derived from the EDL track. */
export interface TrackNodeParams {
  lowDb: number;
  midDb: number;
  highDb: number;
  comp: { thresholdDb: number; ratio: number; attackS: number; releaseS: number; kneeDb: number };
  /** Fader gain x compressor makeup (the export applies makeup inside acompressor, then volume). */
  gain: number;
  pan: number;
}

export function trackNodeParams(track: Pick<StudioTrack, 'gain' | 'pan' | 'effects'>): TrackNodeParams {
  const fx: StudioTrackEffects | undefined = track.effects;
  const c = fx?.compressor;
  return {
    lowDb: fx?.eq?.lowGainDb ?? 0,
    midDb: fx?.eq?.midGainDb ?? 0,
    highDb: fx?.eq?.highGainDb ?? 0,
    // Absent compressor = transparent (threshold 0 dB, ratio 1:1, no knee).
    comp: c
      ? { thresholdDb: c.thresholdDb, ratio: c.ratio, attackS: c.attackMs / 1000, releaseS: c.releaseMs / 1000, kneeDb: TRACK_COMP_KNEE_DB }
      : { thresholdDb: 0, ratio: 1, attackS: 0.003, releaseS: 0.25, kneeDb: 0 },
    gain: (track.gain ?? 1) * (c ? Math.max(1, dbToGain(c.makeupDb)) : 1),
    pan: track.pan ?? 0,
  };
}

/**
 * Degraded no-AudioContext mode: compose clip x track x master into the element
 * volume, capped at 1.0 (HTMLMediaElement.volume can't boost). No EQ/comp.
 */
export function fallbackElementVolume(clipVolume: number, trackGain: number | undefined, masterGain: number | undefined): number {
  return Math.max(0, Math.min(1, clipVolume * (trackGain ?? 1) * (masterGain ?? 1)));
}

export const masterGainOf = (audio: { masterGain?: number } | undefined): number => audio?.masterGain ?? 1;

/** Default strip label: the user's track name, else "A1"/"V1". */
export function trackLabel(track: Pick<StudioTrack, 'kind' | 'index' | 'name'>): string {
  const n = track.name?.trim();
  return n ? n : `${track.kind === 'audio' ? 'A' : 'V'}${track.index + 1}`;
}

/** Tracks that get a mixer strip: audio tracks, plus video tracks carrying a clip with embedded audio. */
export function audioBearingTracks(tracks: readonly StudioTrack[], assets: Record<string, { asset: Pick<StudioAsset, 'hasAudio'> } | undefined>): StudioTrack[] {
  const hasSound = (c: StudioClip) => !c.title && !!assets[c.assetId]?.asset.hasAudio;
  return tracks
    .filter((t) => t.kind === 'audio' || t.clips.some(hasSound))
    .slice()
    .sort((a, b) => (a.kind === b.kind ? a.index - b.index : a.kind === 'audio' ? -1 : 1));
}

export { EQ_BANDS };
