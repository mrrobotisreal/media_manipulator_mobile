// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/effectRegistry.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type {
  StudioEffect,
  StudioEffectType,
  StudioLumetriEffect,
  StudioLutEffect,
  StudioChromaKeyEffect,
  StudioTransitionType,
} from './studioTypes';

/**
 * Effect registry — the single, typed source of truth for every effect and
 * transform parameter in Content Studio (EDL v2). It is consumed by:
 *   (a) the clip inspector controls (slider min/max/step/default + i18n label),
 *   (b) the WebGL2 compositor's uniform packer (preview), and
 *   (c) — by parameter NAME + RANGE parity — the Go ffmpeg emitter in
 *       internal/services/studio_export.go (which references this file by path).
 *
 * Adding a parameter here is the ONLY place a range/default is declared on the
 * TS side; everything else reads it. Keep the ranges identical to the Zod
 * schema in lib/studioTypes.ts and the clamps in studio.go.
 */

/** A numeric, slider-driven parameter. */
export interface EffectParam {
  /** field name on the effect/transform object (identical across the boundary) */
  key: string;
  /** i18n key under the `interface` namespace (contentStudio.*) */
  labelKey: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** optional unit hint for the readout (e.g. '°', 'st', '%') */
  unit?: string;
}

const param = (
  key: string,
  labelKey: string,
  min: number,
  max: number,
  step: number,
  def: number,
  unit?: string,
): EffectParam => ({ key, labelKey, min, max, step, default: def, unit });

/** Motion (Premiere "Motion" effect): position / scale / rotation. */
export const TRANSFORM_PARAMS: EffectParam[] = [
  param('x', 'contentStudio.inspector.motion.x', -1, 1, 0.005, 0),
  param('y', 'contentStudio.inspector.motion.y', -1, 1, 0.005, 0),
  param('scale', 'contentStudio.inspector.motion.scale', 0.01, 10, 0.01, 1),
  param('rotationDeg', 'contentStudio.inspector.motion.rotation', -360, 360, 1, 0, '°'),
];

/** Crop (normalized edge fractions of the source frame). */
export const CROP_PARAMS: EffectParam[] = [
  param('left', 'contentStudio.inspector.crop.left', 0, 0.95, 0.005, 0),
  param('top', 'contentStudio.inspector.crop.top', 0, 0.95, 0.005, 0),
  param('right', 'contentStudio.inspector.crop.right', 0, 0.95, 0.005, 0),
  param('bottom', 'contentStudio.inspector.crop.bottom', 0, 0.95, 0.005, 0),
];

/** Lumetri primary grade. */
export const LUMETRI_PARAMS: EffectParam[] = [
  param('exposure', 'contentStudio.inspector.lumetri.exposure', -3, 3, 0.05, 0, 'st'),
  param('contrast', 'contentStudio.inspector.lumetri.contrast', 0, 2, 0.01, 1),
  param('saturation', 'contentStudio.inspector.lumetri.saturation', 0, 2, 0.01, 1),
  param('temperature', 'contentStudio.inspector.lumetri.temperature', -100, 100, 1, 0),
  param('tint', 'contentStudio.inspector.lumetri.tint', -100, 100, 1, 0),
  param('vibrance', 'contentStudio.inspector.lumetri.vibrance', -2, 2, 0.05, 0),
];

/** LUT mix amount. */
export const LUT_PARAMS: EffectParam[] = [
  param('intensity', 'contentStudio.inspector.lut.intensity', 0, 1, 0.01, 1),
];

/** Chroma key (keyColor is a color swatch, handled outside the slider table). */
export const CHROMAKEY_PARAMS: EffectParam[] = [
  param('similarity', 'contentStudio.inspector.chromakey.similarity', 0.01, 1, 0.01, 0.1),
  param('blend', 'contentStudio.inspector.chromakey.blend', 0, 1, 0.01, 0.1),
  param('despill', 'contentStudio.inspector.chromakey.despill', 0, 1, 0.01, 0.5),
];

/** The slider params for a given effect type. */
export function effectParams(type: StudioEffectType): EffectParam[] {
  switch (type) {
    case 'lumetri':
      return LUMETRI_PARAMS;
    case 'lut':
      return LUT_PARAMS;
    case 'chromakey':
      return CHROMAKEY_PARAMS;
    default:
      return [];
  }
}

/** i18n label key for an effect type (used in the add-effect menu + list). */
export const EFFECT_LABEL_KEYS: Record<StudioEffectType, string> = {
  lumetri: 'contentStudio.inspector.effects.lumetri',
  lut: 'contentStudio.inspector.effects.lut',
  chromakey: 'contentStudio.inspector.effects.chromakey',
};

export const EFFECT_TYPES: StudioEffectType[] = ['lumetri', 'lut', 'chromakey'];

/**
 * Build a fresh effect of `type` with registry defaults. `id` is supplied by the
 * caller (store) so construction stays free of crypto/Date side effects here.
 */
export function makeDefaultEffect(type: StudioEffectType, id: string): StudioEffect {
  switch (type) {
    case 'lumetri': {
      const e: StudioLumetriEffect = {
        type: 'lumetri',
        id,
        enabled: true,
        exposure: 0,
        contrast: 1,
        saturation: 1,
        temperature: 0,
        tint: 0,
        vibrance: 0,
      };
      return e;
    }
    case 'lut': {
      const e: StudioLutEffect = { type: 'lut', id, enabled: true, lutAssetId: '', intensity: 1 };
      return e;
    }
    case 'chromakey': {
      const e: StudioChromaKeyEffect = {
        type: 'chromakey',
        id,
        enabled: true,
        keyColor: '#00FF00',
        similarity: 0.1,
        blend: 0.1,
        despill: 0.5,
      };
      return e;
    }
    default:
      throw new Error(`unknown effect type: ${type as string}`);
  }
}

/**
 * Transition picker taxonomy (part 14): the 15 types grouped the way the UI
 * presents them (Dissolve / Dip / Wipe / Push / Slide). Directional members
 * name WHERE THE ENTERING CLIP COMES FROM — the same rule the preview math
 * (transitionFrameState) and the Go ffmpeg emitter implement.
 */
export interface TransitionTypeGroup {
  /** i18n key suffix under contentStudio.inspector.transitionGroups. */
  key: 'dissolve' | 'dip' | 'wipe' | 'push' | 'slide';
  types: StudioTransitionType[];
}

export const TRANSITION_TYPE_GROUPS: TransitionTypeGroup[] = [
  { key: 'dissolve', types: ['crossDissolve'] },
  { key: 'dip', types: ['dipToBlack', 'dipToWhite'] },
  { key: 'wipe', types: ['wipeLeft', 'wipeRight', 'wipeUp', 'wipeDown'] },
  { key: 'push', types: ['pushLeft', 'pushRight', 'pushUp', 'pushDown'] },
  { key: 'slide', types: ['slideLeft', 'slideRight', 'slideUp', 'slideDown'] },
];

/** Identity transform (matches studioTransformSchema defaults). */
export const IDENTITY_TRANSFORM = { x: 0, y: 0, scale: 1, rotationDeg: 0 } as const;
/** Zero crop (matches studioCropSchema defaults). */
export const ZERO_CROP = { left: 0, top: 0, right: 0, bottom: 0 } as const;

// ---------------------------------------------------------------------------
// EDL v3 ranges — MIRRORED BY GO. Every number below is duplicated in the Go
// sanitizer (internal/models/studio_sanitize.go); change both or neither. The
// Zod schema in lib/studioTypes.ts also repeats the hard bounds, matching how
// the v2 params above are kept in lockstep. Parts 14–21 read these for their
// inspector sliders; in part 05 the fields exist but drive no UI or export.
// ---------------------------------------------------------------------------
export const STUDIO_V3_RANGES = {
  /** Clip-edge transition (all 15 types share one duration range). */
  transitionDurationSeconds: { min: 0.1, max: 5, step: 0.05, default: 1 },
  /** Hard cap per keyframe property array (mirrors the volumeKeyframes cap). */
  keyframesPerProperty: 64,
  /** Keyframe value bounds reuse each property's own range. */
  keyframeValue: {
    positionX: { min: -1, max: 1, default: 0 },
    positionY: { min: -1, max: 1, default: 0 },
    scale: { min: 0.01, max: 10, default: 1 },
    rotation: { min: -360, max: 360, default: 0 },
    opacity: { min: 0, max: 1, default: 1 },
    volume: { min: 0, max: 2, default: 1 },
    pan: { min: -1, max: 1, default: 0 },
  },
  /** Clip speed (rate). freeze is mutually exclusive with speed/reverse. */
  speed: { min: 0.1, max: 10, step: 0.05, default: 1 },
  /** Track mixer. */
  trackGain: { min: 0, max: 2, step: 0.01, default: 1 },
  trackPan: { min: -1, max: 1, step: 0.01, default: 0 },
  /** Project master fader (audio.masterGain; part 19). Same 0..2 linear range as track gain. */
  masterGain: { min: 0, max: 2, step: 0.01, default: 1 },
  /** Mixer fader scale in dB (UI only): bottom = -inf, +6 dB top = linear 2. */
  faderDb: { min: -60, max: 6.020599913279624 },
  trackNameMaxLength: 80,
  /** Track 3-band EQ (shared range for low/mid/high shelf gains). */
  eqGainDb: { min: -12, max: 12, step: 0.5, default: 0 },
  /** Track compressor. */
  compressor: {
    thresholdDb: { min: -60, max: 0, step: 1, default: -24 },
    ratio: { min: 1, max: 20, step: 0.5, default: 4 },
    attackMs: { min: 1, max: 200, step: 1, default: 10 },
    releaseMs: { min: 20, max: 1000, step: 10, default: 250 },
    makeupDb: { min: 0, max: 12, step: 0.5, default: 0 },
  },
  /** Title clips (assetless). Pixel fields are project-resolution px. */
  title: {
    maxLayers: 8,
    maxTextLength: 500,
    defaultFontFamily: 'Inter',
    fontSizePx: { min: 8, max: 500, step: 1, default: 64 },
    strokeWidthPx: { min: 0, max: 50, step: 1, default: 0 },
    shadowOffsetPx: { min: -100, max: 100, step: 1, default: 0 },
    shadowBlurPx: { min: 0, max: 100, step: 1, default: 8 },
    backgroundPaddingPx: { min: 0, max: 200, step: 1, default: 12 },
    cornerRadiusPx: { min: 0, max: 200, step: 1, default: 0 },
    letterSpacingPx: { min: -20, max: 100, step: 0.5, default: 0 },
    lineHeight: { min: 0.5, max: 3, step: 0.05, default: 1.2 },
    lineThicknessPx: { min: 1, max: 100, step: 1, default: 4 },
  },
  /** Project markers. */
  markers: { max: 500, maxNameLength: 80, maxCommentLength: 500, defaultColor: '#22C55E' },
} as const;
