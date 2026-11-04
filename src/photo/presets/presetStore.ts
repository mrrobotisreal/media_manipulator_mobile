/**
 * Presets on the phone (ticket MA51 decision 8; MA53: the MMKV store is now only the source of the
 * one-time migration to the account, `migration.ts`, and of the per-preset Upload). Built-ins and Auto are the web's code
 * (`presets/index.ts`, `presets/autoPreset.ts`, copied by the sync). User presets live in MMKV
 * under `photoPresets`, one JSON array of the web's `UserPreset` records (`id, name, category,
 * layers, createdAt`: MM103's `photo_presets` columns plus the local id), validated through the
 * same `sanitizeUserPreset`, so MA53 can migrate this store to the account unchanged. JSON
 * export/import uses the web's `aperture-presets` v1 format (`exportUserPresets`,
 * `parseUserPresetsJson`).
 *
 * Since MA53 every new preset is saved on the account (`../presetsApi.ts`); nothing writes new
 * presets here any more, only the migration removes the ones it uploaded.
 */
import { computeAutoPreset } from './autoPreset';
import {
  appendPreset,
  BUILTIN_PRESETS,
  parsePresetLayers,
  presetById,
  presetGroupName,
} from './index';
import {
  exportUserPresets,
  newPresetId,
  parseUserPresetsJson,
  sanitizeUserPreset,
  USER_PRESET_NAME_MAX,
  type ImportResult,
  type UserPreset,
  type UserPresetCategoryId,
} from './userStore';
import type { AdjustmentLayer, PhotoDoc } from '../photoTypes';

export const USER_PRESETS_KEY = 'photoPresets';

export interface KvStorage {
  getItem(key: string): Promise<string | null | undefined>;
  setItem(key: string, value: string): Promise<void>;
}

export type { UserPreset };

/** A 256-bin RGB histogram (the web's `Histogram` shape the Auto preset reads). */
export interface Histogram256 {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
}

/** 256-bin histogram of an RGBA8 readback (transparent pixels skipped, like the web). */
export function histogram256(rgba: ArrayLike<number>): Histogram256 {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    r[rgba[i] as number]! += 1;
    g[rgba[i + 1] as number]! += 1;
    b[rgba[i + 2] as number]! += 1;
  }
  return { r, g, b };
}

/** A built-in preset's layers: the JSON's, or Auto computed from the preview histogram. */
export function builtinLayers(
  id: string,
  histogram: Histogram256 | null,
): AdjustmentLayer[] | null {
  const def = presetById(id);
  if (!def) return null;
  if (def.computed) return histogram ? computeAutoPreset(histogram).layers : null;
  return parsePresetLayers(def.layers);
}

/** Apply a preset as one group (web `appendPreset`); returns the same doc when nothing fits. */
export function applyPreset(
  doc: PhotoDoc,
  presetId: string,
  layers: AdjustmentLayer[],
  displayName: string,
): PhotoDoc {
  return appendPreset(doc, presetId, layers, presetGroupName(displayName));
}

export { BUILTIN_PRESETS, presetGroupName };

/** The device's user presets, newest first; anything unreadable is dropped, never thrown. */
export async function listUserPresets(kv: KvStorage): Promise<UserPreset[]> {
  let raw: unknown;
  try {
    raw = JSON.parse((await kv.getItem(USER_PRESETS_KEY)) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeUserPreset)
    .filter((p): p is UserPreset => p !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** A saved stack: masks and group headers belong to the photo, not the look (MA51; MA53 reuses it). */
export function presetLayersOf(layers: AdjustmentLayer[]): AdjustmentLayer[] {
  return layers.map((l) => {
    const { group: _g, ...rest } = l as AdjustmentLayer & { group?: string };
    void _g;
    return { ...rest, mask: null } as AdjustmentLayer;
  });
}

async function write(kv: KvStorage, list: UserPreset[]): Promise<void> {
  await kv.setItem(USER_PRESETS_KEY, JSON.stringify(list));
}

export async function saveUserPreset(
  kv: KvStorage,
  input: { name: string; layers: AdjustmentLayer[]; category?: UserPresetCategoryId | null },
  now = () => new Date().toISOString(),
): Promise<UserPreset | null> {
  const p = sanitizeUserPreset({
    id: newPresetId(),
    name: input.name,
    category: input.category ?? 'custom',
    layers: presetLayersOf(input.layers),
    createdAt: now(),
  });
  if (!p) return null;
  await write(kv, [p, ...(await listUserPresets(kv))]);
  return p;
}

export async function renameUserPreset(kv: KvStorage, id: string, name: string): Promise<boolean> {
  const n = name.trim();
  if (n === '' || n.length > USER_PRESET_NAME_MAX) return false;
  const list = await listUserPresets(kv);
  if (!list.some((p) => p.id === id)) return false;
  await write(
    kv,
    list.map((p) => (p.id === id ? { ...p, name: n } : p)),
  );
  return true;
}

export async function deleteUserPreset(kv: KvStorage, id: string): Promise<boolean> {
  const list = await listUserPresets(kv);
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  await write(kv, next);
  return true;
}

export const exportPresetsJson = (presets: UserPreset[]): string => exportUserPresets(presets);

/** Import a file's presets (fresh ids, the file refused as a whole when anything is invalid). */
export async function importPresetsJson(kv: KvStorage, text: string): Promise<ImportResult> {
  const r = parseUserPresetsJson(text);
  if (!r.ok) return r;
  await write(kv, [...r.presets, ...(await listUserPresets(kv))]);
  return r;
}
