// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/audioPresets.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioTrackCompressor, StudioTrackEffects, StudioTrackEq } from './studioTypes';
import { STUDIO_V3_RANGES } from './effectRegistry';

/**
 * Track-effect presets and constants (Darkroom v3 part 19).
 *
 * EQ_BANDS / TRACK_COMP_KNEE_DB are MIRRORED by the Go export
 * (trackEQ*Hz / trackCompKnee in internal/services/studio_export.go):
 * low shelf 120 Hz, peaking 1 kHz (Q 1), high shelf 8 kHz (slope 1), and a
 * 9 dB (linear 2.82843) compressor knee.
 */
export const EQ_BANDS = {
  low: { type: 'lowshelf', hz: 120 },
  mid: { type: 'peaking', hz: 1000, q: 1 },
  high: { type: 'highshelf', hz: 8000 },
} as const;
export const TRACK_COMP_KNEE_DB = 9;

export type AudioPresetId = 'voiceClarity' | 'musicBed' | 'podcast';

export interface AudioPreset {
  id: AudioPresetId;
  /** English fallback label (the UI localizes via contentStudio.mixer.preset.<id>). */
  label: string;
  eq: StudioTrackEq;
  compressor: StudioTrackCompressor;
}

export const AUDIO_PRESETS: readonly AudioPreset[] = [
  {
    id: 'voiceClarity',
    label: 'Voice clarity',
    eq: { lowGainDb: -4, midGainDb: 2, highGainDb: 3 },
    compressor: { thresholdDb: -22, ratio: 3, attackMs: 8, releaseMs: 180, makeupDb: 3 },
  },
  {
    id: 'musicBed',
    label: 'Music bed',
    eq: { lowGainDb: 1, midGainDb: -3, highGainDb: 1 },
    compressor: { thresholdDb: -18, ratio: 2, attackMs: 30, releaseMs: 400, makeupDb: 1 },
  },
  {
    id: 'podcast',
    label: 'Podcast',
    eq: { lowGainDb: -3, midGainDb: 1.5, highGainDb: 2 },
    compressor: { thresholdDb: -26, ratio: 4, attackMs: 10, releaseMs: 250, makeupDb: 4 },
  },
];

export const presetById = (id: string): AudioPreset | undefined => AUDIO_PRESETS.find((p) => p.id === id);

/** Fresh copies (the document must never alias a preset's objects). */
export function presetEffects(p: AudioPreset): StudioTrackEffects {
  return { eq: { ...p.eq }, compressor: { ...p.compressor } };
}

export const FLAT_EQ: StudioTrackEq = { lowGainDb: 0, midGainDb: 0, highGainDb: 0 };

export function defaultCompressor(): StudioTrackCompressor {
  const c = STUDIO_V3_RANGES.compressor;
  return {
    thresholdDb: c.thresholdDb.default,
    ratio: c.ratio.default,
    attackMs: c.attackMs.default,
    releaseMs: c.releaseMs.default,
    makeupDb: c.makeupDb.default,
  };
}

/**
 * Collapse effects to the canonical stored form: a flat EQ and an absent
 * compressor mean "no effects" (undefined) so untouched tracks stay byte-stable.
 */
export function normalizeTrackEffects(fx: StudioTrackEffects | undefined): StudioTrackEffects | undefined {
  if (!fx) return undefined;
  const eqFlat = !fx.eq || (fx.eq.lowGainDb === 0 && fx.eq.midGainDb === 0 && fx.eq.highGainDb === 0);
  const out: StudioTrackEffects = {};
  if (!eqFlat) out.eq = fx.eq;
  if (fx.compressor) out.compressor = fx.compressor;
  return out.eq || out.compressor ? out : undefined;
}

/** Which preset (if any) the effects currently match exactly. */
export function matchingPreset(fx: StudioTrackEffects | undefined): AudioPresetId | null {
  if (!fx?.eq || !fx.compressor) return null;
  const hit = AUDIO_PRESETS.find(
    (p) =>
      p.eq.lowGainDb === fx.eq!.lowGainDb &&
      p.eq.midGainDb === fx.eq!.midGainDb &&
      p.eq.highGainDb === fx.eq!.highGainDb &&
      p.compressor.thresholdDb === fx.compressor!.thresholdDb &&
      p.compressor.ratio === fx.compressor!.ratio &&
      p.compressor.attackMs === fx.compressor!.attackMs &&
      p.compressor.releaseMs === fx.compressor!.releaseMs &&
      p.compressor.makeupDb === fx.compressor!.makeupDb,
  );
  return hit?.id ?? null;
}
