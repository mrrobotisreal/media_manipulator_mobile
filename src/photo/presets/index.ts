// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/presets/index.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Built-in presets (design §5.5, MM99 decision 3). Each JSON is
 * `{id, nameKey, category, layers}` where `layers` is a partial doc of layer
 * objects whose ids are prefixed `preset-<id>-`. Applying a preset APPENDS its
 * layers (never replaces the stack) grouped under a `Preset: <name>` header
 * (the additive `layer.group` field). The same JSON ships in the app (MA51).
 */
import { PHOTO_ID_PATTERN, PHOTO_MAX_LAYERS, layerSchema, type AdjustmentLayer, type PhotoDoc } from '../photoTypes';
import { uniqueLayerId } from '../layerOps';

import bwFilm from './builtin/bw-film.json';
import bwHighContrast from './builtin/bw-high-contrast.json';
import colorPopBlue from './builtin/color-pop-blue.json';
import colorPopCyan from './builtin/color-pop-cyan.json';
import colorPopGreen from './builtin/color-pop-green.json';
import colorPopMagenta from './builtin/color-pop-magenta.json';
import colorPopRed from './builtin/color-pop-red.json';
import colorPopYellow from './builtin/color-pop-yellow.json';
import coolPreset from './builtin/cool.json';
import crossProcess from './builtin/cross-process.json';
import fade from './builtin/fade.json';
import landscape from './builtin/landscape.json';
import matte from './builtin/matte.json';
import portraitSoften from './builtin/portrait-soften.json';
import punch from './builtin/punch.json';
import vintage from './builtin/vintage.json';
import vivid from './builtin/vivid.json';
import warmPreset from './builtin/warm.json';

export const PRESET_CATEGORIES = ['color', 'bw', 'film', 'fix'] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];
/** User presets may also be `custom` (MM103 `photo_presets.category`). */
export type UserPresetCategory = PresetCategory | 'custom';

export interface PresetDef {
  id: string;
  nameKey: string;
  category: PresetCategory;
  /** Layer objects (parsed through the schema on use). */
  layers: Record<string, unknown>[];
  /** `auto` is computed from the image, not stored. */
  computed?: boolean;
}

const RAW = [
  colorPopRed, colorPopYellow, colorPopGreen, colorPopCyan, colorPopBlue, colorPopMagenta,
  bwFilm, bwHighContrast, warmPreset, coolPreset, matte, fade, vivid, punch, crossProcess, vintage, portraitSoften, landscape,
] as unknown as PresetDef[];

/** The auto preset has no fixed layers (see `autoPreset.ts`). */
export const AUTO_PRESET: PresetDef = { id: 'auto', nameKey: 'photo.presets.name.auto', category: 'fix', layers: [], computed: true };

export const BUILTIN_PRESETS: readonly PresetDef[] = [...RAW, AUTO_PRESET];
export const presetById = (id: string): PresetDef | undefined => BUILTIN_PRESETS.find((p) => p.id === id);

/** Parse raw layer objects into schema-valid layers (ids kept); returns null when any layer is invalid. */
export function parsePresetLayers(raw: unknown): AdjustmentLayer[] | null {
  if (!Array.isArray(raw) || raw.length > PHOTO_MAX_LAYERS) return null;
  const out: AdjustmentLayer[] = [];
  for (const l of raw) {
    const r = layerSchema.safeParse(l);
    if (!r.success) return null;
    out.push(r.data);
  }
  return out;
}

export const presetGroupName = (displayName: string): string => `Preset: ${displayName}`.slice(0, 80);

/**
 * Append `layers` to the document as one group. Ids are re-prefixed
 * `preset-<presetId>-<n>` and made unique against the stack; every layer gets
 * `group`. Layer cap is respected (returns the doc unchanged when it would
 * exceed it).
 */
export function appendPreset(doc: PhotoDoc, presetId: string, layers: AdjustmentLayer[], groupName: string): PhotoDoc {
  if (layers.length === 0 || doc.layers.length + layers.length > PHOTO_MAX_LAYERS) return doc;
  const stem = presetId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || 'x';
  let working: Pick<PhotoDoc, 'layers'> = doc;
  const added: AdjustmentLayer[] = [];
  layers.forEach((l, i) => {
    const id = uniqueLayerId(working, `preset-${stem}-${i + 1}`);
    const next = { ...structuredClone(l), id, group: groupName } as AdjustmentLayer;
    added.push(next);
    working = { layers: [...working.layers, next] };
  });
  return { ...doc, layers: [...doc.layers, ...added] };
}

export const isValidPresetId = (id: string): boolean => PHOTO_ID_PATTERN.test(id);
