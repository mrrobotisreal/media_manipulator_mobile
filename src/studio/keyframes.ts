// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/keyframes.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioClip, StudioClipKeyframes, StudioKeyframe } from './studioTypes';
import {
  STUDIO_V3_RANGES,
  LUMETRI_PARAMS,
  LUT_PARAMS,
  CHROMAKEY_PARAMS,
} from './effectRegistry';

/**
 * Keyframe lane addressing (part 15). A "property" is either one of the seven
 * named lanes on StudioClipKeyframes, or an effect-param key of the form
 * "<effectId>.<param>" (the part-05 contract) stored in `keyframes.effects`.
 * The store's keyframe actions, the inspector's stopwatch rows, and the
 * timeline strip all speak this vocabulary.
 */

export const NAMED_KEYFRAME_PROPERTIES = [
  'positionX',
  'positionY',
  'scale',
  'rotation',
  'opacity',
  'volume',
  'pan',
] as const;
export type NamedKeyframeProperty = (typeof NAMED_KEYFRAME_PROPERTIES)[number];

/** True when `property` addresses `keyframes.effects` ("<effectId>.<param>"). */
export function isEffectKeyframeProperty(property: string): boolean {
  return property.includes('.');
}

/**
 * The analytics subkey for a property (ADR ws/0003: low-cardinality only).
 * Effect keys report the PARAM name — never the effect id, which is a
 * per-document random id and would explode cardinality.
 */
export function keyframeAnalyticsSubkey(property: string): string {
  if (!isEffectKeyframeProperty(property)) return property;
  return property.slice(property.lastIndexOf('.') + 1);
}

/** The lane for a property, or undefined when not armed. */
export function keyframeLane(clip: StudioClip, property: string): StudioKeyframe[] | undefined {
  const k = clip.keyframes;
  if (!k) return undefined;
  if (isEffectKeyframeProperty(property)) return k.effects?.[property];
  return k[property as NamedKeyframeProperty];
}

/** Effect-param value ranges by PARAM name (mirrors the registry tables). */
const EFFECT_PARAM_RANGES: Record<string, { min: number; max: number }> = Object.fromEntries(
  [...LUMETRI_PARAMS, ...LUT_PARAMS, ...CHROMAKEY_PARAMS].map((p) => [
    p.key,
    { min: p.min, max: p.max },
  ]),
);

/** Value clamp range for a property (named lanes + effect params). */
export function keyframeValueRange(property: string): { min: number; max: number } {
  if (isEffectKeyframeProperty(property)) {
    const param = property.slice(property.lastIndexOf('.') + 1);
    return EFFECT_PARAM_RANGES[param] ?? { min: -Infinity, max: Infinity };
  }
  const r = STUDIO_V3_RANGES.keyframeValue[property as NamedKeyframeProperty];
  return r ? { min: r.min, max: r.max } : { min: -Infinity, max: Infinity };
}

/** Two keyframe times within this epsilon are "the same point" (store + sanitizer dedupe). */
export const KEYFRAME_TIME_EPSILON = 1e-4;

/** UI epsilon for "the playhead is on this keyframe" (≈ half a 30fps frame). */
export const KEYFRAME_HIT_EPSILON = 0.017;

/** The keyframe at time ≈ t in a lane, or undefined. */
export function keyframeAt(
  lane: StudioKeyframe[] | undefined,
  t: number,
  epsilon = KEYFRAME_HIT_EPSILON,
): StudioKeyframe | undefined {
  return lane?.find((k) => Math.abs(k.t - t) <= epsilon);
}

/** Timeline strip grouping: which visual row/color a property belongs to. */
export type KeyframePropertyGroup = 'motion' | 'opacity' | 'audio' | 'effects';

export function keyframePropertyGroup(property: string): KeyframePropertyGroup {
  if (isEffectKeyframeProperty(property)) return 'effects';
  switch (property) {
    case 'positionX':
    case 'positionY':
    case 'scale':
    case 'rotation':
      return 'motion';
    case 'opacity':
      return 'opacity';
    default:
      return 'audio';
  }
}

export interface ClipKeyframeLane {
  property: string;
  group: KeyframePropertyGroup;
  keyframes: StudioKeyframe[];
}

/** Every non-empty lane on a clip (named lanes first, then effect params). */
export function clipKeyframeLanes(clip: StudioClip): ClipKeyframeLane[] {
  const k = clip.keyframes;
  if (!k) return [];
  const out: ClipKeyframeLane[] = [];
  for (const property of NAMED_KEYFRAME_PROPERTIES) {
    const lane = k[property];
    if (lane && lane.length > 0) {
      out.push({ property, group: keyframePropertyGroup(property), keyframes: lane });
    }
  }
  for (const [property, lane] of Object.entries(k.effects ?? {})) {
    if (lane.length > 0) out.push({ property, group: 'effects', keyframes: lane });
  }
  return out;
}

/** True when any lane on the clip has a keyframe. */
export function clipHasKeyframes(clip: StudioClip): boolean {
  return clipKeyframeLanes(clip).length > 0;
}

/**
 * Drops empty lanes; returns undefined when nothing is left so untouched clips
 * serialize without a `keyframes` container (byte-stability with pre-15 docs).
 */
export function pruneClipKeyframes(k: StudioClipKeyframes): StudioClipKeyframes | undefined {
  const out: StudioClipKeyframes = {};
  let any = false;
  for (const property of NAMED_KEYFRAME_PROPERTIES) {
    const lane = k[property];
    if (lane && lane.length > 0) {
      out[property] = lane;
      any = true;
    }
  }
  const effects: Record<string, StudioKeyframe[]> = {};
  let anyEffects = false;
  for (const [key, lane] of Object.entries(k.effects ?? {})) {
    if (lane.length > 0) {
      effects[key] = lane;
      anyEffects = true;
    }
  }
  if (anyEffects) {
    out.effects = effects;
    any = true;
  }
  return any ? out : undefined;
}
