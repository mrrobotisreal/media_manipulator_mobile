/**
 * The one-time move of MA51's device presets (MMKV `photoPresets`) to the account (ticket MA53
 * decision 3, mirroring MM103's web rule in `lib/photo/presetsApi.ts`):
 *
 * - offered when the account has zero presets, the device has some, and the user has not declined;
 * - Keep uploads them oldest first (so the account's newest-first list keeps the device order) up to
 *   the plan's cap, removing each device copy as soon as it is on the account; the rest stay on the
 *   device with a note;
 * - declining sets `photoPresetsMigrationDeclined` and never asks again; every device preset then
 *   gets its own Upload, as it does when the account already has presets (never a bulk upload then,
 *   so a web migration is not duplicated).
 *
 * Pure over an injected `create` (the RTK mutation in the app, a fake in tests).
 */
import type { MmError } from '@/api/errors';
import { deleteUserPreset, type KvStorage, type UserPreset } from './presetStore';
import type { AdjustmentLayer } from '../photoTypes';
import type { UserPresetCategoryId } from './userStore';

export const MIGRATION_DECLINED_KEY = 'photoPresetsMigrationDeclined';

export type CreateAccountPreset = (p: {
  name: string;
  category: UserPresetCategoryId | null;
  layers: AdjustmentLayer[];
}) => Promise<{ ok: true } | { ok: false; error: MmError }>;

export async function migrationDeclined(kv: KvStorage): Promise<boolean> {
  try {
    return (await kv.getItem(MIGRATION_DECLINED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setMigrationDeclined(kv: KvStorage): Promise<void> {
  await kv.setItem(MIGRATION_DECLINED_KEY, '1');
}

/** Whether to show the prompt: no account presets, some device presets, never declined. */
export const shouldOfferMigration = (
  serverCount: number,
  local: readonly UserPreset[],
  declined: boolean,
): boolean => serverCount === 0 && local.length > 0 && !declined;

export interface MigrationResult {
  /** Now on the account (and gone from the device). */
  uploaded: number;
  /** Still on the device: over the cap, refused, or not tried after a lost connection. */
  remaining: number;
  /** The plan's cap stopped the upload (403 `photo_presets_limit`). */
  capped: boolean;
  /** The first error that was not the cap (the connection, or a preset the server refused). */
  error?: MmError;
}

/** Upload one device preset; on success its device copy is removed. */
export async function uploadLocalPreset(
  kv: KvStorage,
  p: UserPreset,
  create: CreateAccountPreset,
): Promise<{ ok: true } | { ok: false; error: MmError }> {
  const r = await create({ name: p.name, category: p.category, layers: p.layers });
  if (r.ok) await deleteUserPreset(kv, p.id);
  return r;
}

/** Keep: upload `local` (newest first, as listed) oldest first until the cap. */
export async function migrateLocalPresets(
  kv: KvStorage,
  local: readonly UserPreset[],
  create: CreateAccountPreset,
): Promise<MigrationResult> {
  let uploaded = 0;
  let capped = false;
  let error: MmError | undefined;
  for (const p of [...local].reverse()) {
    const r = await uploadLocalPreset(kv, p, create);
    if (r.ok) {
      uploaded += 1;
      continue;
    }
    if (r.error.code === 'photo_presets_limit') {
      capped = true;
      break;
    }
    error ??= r.error;
    // No connection: stop, the rest stay for the next try. A refused preset: keep it, try the rest.
    if (r.error.code === 'network' || r.error.code === 'timeout') break;
  }
  return { uploaded, remaining: local.length - uploaded, capped, error };
}
