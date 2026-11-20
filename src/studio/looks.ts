// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/looks.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * MM109: Darkroom looks (design MEDI_ASSISTANT.md §8.5, ticket decision 3).
 *
 * Named colour grades built ONLY from the existing Lumetri parameters, so the preview
 * (WebGL, `colorMath.ts`) and the export (ffmpeg `lumetriArgs`) already render them
 * identically (ADR-0002 parity: no renderer change). A look is applied as one Lumetri effect
 * on each clip, tagged by its effect id (`look-<lookId>`) so re-applying a look replaces the
 * previous one instead of stacking grades. `intensity` mixes each parameter linearly from its
 * neutral value toward the look's value.
 *
 * Darkroom has no vignette or letterbox primitive in the effect chain, so no look carries one
 * (the ticket allows omitting them rather than adding a renderer feature); a "letterbox" is a
 * title clip with two black bars, which Medi can build with `add_title` separately.
 *
 * Shared by the Effects panel's Looks row (everyone) and Medi's `apply_look` op.
 */
import type { StudioClip, StudioLumetriEffect } from './studioTypes';
import { LUMETRI_PARAMS } from './effectRegistry';

export type LookLumetri = Pick<StudioLumetriEffect, 'exposure' | 'contrast' | 'saturation' | 'temperature' | 'tint' | 'vibrance'>;

export interface StudioLook {
  id: string;
  /** i18n key under `interface` (panels.json `contentStudio.looks.*`). */
  labelKey: string;
  /** The full-strength grade (intensity 1). */
  lumetri: LookLumetri;
  /** Swatch for the Looks row: two colours that read as the look's feel. */
  swatch: [string, string];
}

const look = (id: string, lumetri: Partial<LookLumetri>, swatch: [string, string]): StudioLook => ({
  id,
  labelKey: `contentStudio.looks.${id}`,
  lumetri: { ...NEUTRAL_LUMETRI, ...lumetri },
  swatch,
});

/** The neutral value of every Lumetri parameter (the registry defaults). */
export const NEUTRAL_LUMETRI: LookLumetri = Object.fromEntries(LUMETRI_PARAMS.map((p) => [p.key, p.default])) as unknown as LookLumetri;

/** The catalog, in display order. Ids are the closed vocabulary of `apply_look` (do not rename). */
export const STUDIO_LOOKS: readonly StudioLook[] = [
  look('cinematic', { exposure: -0.1, contrast: 1.15, saturation: 0.85, temperature: 6, vibrance: -0.1 }, ['#1f3b4d', '#c98a5a']),
  look('teal-orange', { contrast: 1.12, saturation: 0.95, temperature: 14, tint: -6, vibrance: 0.35 }, ['#1b6f78', '#e3893f']),
  look('bleach-bypass', { exposure: 0.05, contrast: 1.35, saturation: 0.45, vibrance: -0.3 }, ['#5d6366', '#c7c9c4']),
  look('warm-film', { exposure: 0.05, contrast: 0.92, saturation: 0.9, temperature: 22, tint: 4 }, ['#8a5a3a', '#e8c48f']),
  look('cool-night', { exposure: -0.35, contrast: 1.08, saturation: 0.8, temperature: -28, tint: 6 }, ['#101c35', '#4d6fa3']),
  look('vintage', { exposure: 0.1, contrast: 0.85, saturation: 0.7, temperature: 18, tint: 8, vibrance: -0.25 }, ['#7d6a4f', '#d9c39b']),
  look('high-key', { exposure: 0.45, contrast: 0.85, saturation: 0.9, vibrance: 0.1 }, ['#e9eef0', '#ffffff']),
  look('noir', { exposure: -0.1, contrast: 1.4, saturation: 0 }, ['#111111', '#bdbdbd']),
  look('pastel', { exposure: 0.25, contrast: 0.8, saturation: 0.75, tint: 6, vibrance: 0.2 }, ['#f2c6d2', '#bfe3e0']),
  look('punchy-social', { exposure: 0.1, contrast: 1.18, saturation: 1.25, vibrance: 0.45 }, ['#ff4d6d', '#ffd23f']),
  look('moody', { exposure: -0.3, contrast: 1.2, saturation: 0.7, temperature: -8, vibrance: -0.2 }, ['#1d2426', '#5b6b63']),
  look('golden-hour', { exposure: 0.1, contrast: 1.05, saturation: 1.05, temperature: 32, tint: 6, vibrance: 0.2 }, ['#d9822b', '#f6d27a']),
];

export const STUDIO_LOOK_IDS = STUDIO_LOOKS.map((l) => l.id) as [string, ...string[]];

export const lookById = (id: string): StudioLook | undefined => STUDIO_LOOKS.find((l) => l.id === id);

/** The effect id a look writes, so re-applying any look replaces it (one look per clip). */
export const lookEffectId = (id: string): string => `look-${id}`;
export const isLookEffectId = (id: string): boolean => id.startsWith('look-');

const round = (v: number) => Math.round(v * 1000) / 1000;

/** The look's grade at `intensity` (0 = neutral, 1 = full look). */
export function lookLumetri(l: StudioLook, intensity = 1): LookLumetri {
  const k = Math.max(0, Math.min(1, intensity));
  const out = {} as Record<string, number>;
  for (const p of LUMETRI_PARAMS) {
    const v = (l.lumetri as unknown as Record<string, number>)[p.key];
    out[p.key] = round(p.default + (v - p.default) * k);
  }
  return out as unknown as LookLumetri;
}

/**
 * The clip with the look applied: any earlier look effect is replaced in place (its position in
 * the chain kept), otherwise the look's Lumetri effect is prepended so the user's own effects
 * (LUTs, keys) still run after it.
 */
export function withLook(clip: StudioClip, l: StudioLook, intensity = 1): StudioClip {
  const effect: StudioLumetriEffect = { type: 'lumetri', id: lookEffectId(l.id), enabled: true, ...lookLumetri(l, intensity) };
  const effects = clip.effects ?? [];
  const at = effects.findIndex((e) => isLookEffectId(e.id));
  const next = at >= 0 ? effects.map((e, i) => (i === at ? effect : e)) : [effect, ...effects];
  return { ...clip, effects: next };
}
