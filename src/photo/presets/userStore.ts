// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/presets/userStore.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Browser-local user presets (design §5.5, MM99 decision 5): IndexedDB
 * database `photo-presets`, store `presets`, records
 * `{id, name, category, layers, createdAt}` (the columns of MM103's
 * `photo_presets`, so the sign-in migration is a straight upload). Every access
 * is wrapped: without IndexedDB (private mode, blocked) the functions resolve
 * to empty/false and the editor keeps working.
 *
 * JSON import/export: `{ format: 'aperture-presets', version: 1, presets: [...] }`;
 * import validates each preset through the layer schema and refuses the file as
 * a whole when anything is invalid.
 */
import { PHOTO_MAX_LAYERS, layerSchema, type AdjustmentLayer } from '../photoTypes';

export const USER_PRESET_DB = 'photo-presets';
export const USER_PRESET_STORE = 'presets';
export const USER_PRESET_NAME_MAX = 60;
export const USER_PRESET_MAX_BYTES = 1024 * 1024;
export const USER_PRESET_EXPORT_FORMAT = 'aperture-presets';
export const USER_PRESET_CATEGORIES = ['color', 'bw', 'film', 'fix', 'custom'] as const;
export type UserPresetCategoryId = (typeof USER_PRESET_CATEGORIES)[number];

export interface UserPreset {
  id: string;
  name: string;
  category: UserPresetCategoryId | null;
  layers: AdjustmentLayer[];
  /** ISO-8601, client clock. */
  createdAt: string;
}

let warned = false;
const warnOnce = (e: unknown) => {
  if (warned) return;
  warned = true;
  console.warn('[photo] browser presets unavailable this session', e);
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(USER_PRESET_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(USER_PRESET_STORE)) req.result.createObjectStore(USER_PRESET_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}
const done = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  });

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T>): Promise<T | null> {
  let db: IDBDatabase | null = null;
  try {
    if (typeof indexedDB === 'undefined') throw new Error('indexedDB is not defined');
    db = await openDb();
    const tx = db.transaction(USER_PRESET_STORE, mode);
    const out = await fn(tx.objectStore(USER_PRESET_STORE));
    await txDone(tx);
    return out;
  } catch (e) {
    warnOnce(e);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

export function sanitizeUserPreset(raw: unknown): UserPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id)) return null;
  if (typeof r.name !== 'string' || r.name.trim() === '' || r.name.length > USER_PRESET_NAME_MAX) return null;
  const category = r.category === null || r.category === undefined ? null : (USER_PRESET_CATEGORIES as readonly unknown[]).includes(r.category) ? (r.category as UserPresetCategoryId) : undefined;
  if (category === undefined) return null;
  if (!Array.isArray(r.layers) || r.layers.length === 0 || r.layers.length > PHOTO_MAX_LAYERS) return null;
  const layers: AdjustmentLayer[] = [];
  for (const l of r.layers) {
    const p = layerSchema.safeParse(l);
    if (!p.success) return null;
    layers.push(p.data);
  }
  if (JSON.stringify(layers).length > USER_PRESET_MAX_BYTES) return null;
  const createdAt = typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt)) ? r.createdAt : new Date(0).toISOString();
  return { id: r.id, name: r.name.trim(), category, layers, createdAt };
}

export const newPresetId = (): string => `up-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Newest first. */
export async function listUserPresets(): Promise<UserPreset[]> {
  const all = await withStore('readonly', (s) => done(s.getAll() as IDBRequest<unknown[]>));
  if (!all) return [];
  return all.map(sanitizeUserPreset).filter((p): p is UserPreset => p !== null).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function saveUserPreset(input: { name: string; category?: UserPresetCategoryId | null; layers: AdjustmentLayer[]; id?: string; createdAt?: string }): Promise<UserPreset | null> {
  const p = sanitizeUserPreset({ id: input.id ?? newPresetId(), name: input.name, category: input.category ?? 'custom', layers: input.layers, createdAt: input.createdAt ?? new Date().toISOString() });
  if (!p) return null;
  const ok = await withStore('readwrite', async (s) => {
    await done(s.put(p));
    return true;
  });
  return ok ? p : null;
}

export async function renameUserPreset(id: string, name: string): Promise<boolean> {
  const n = name.trim();
  if (n === '' || n.length > USER_PRESET_NAME_MAX) return false;
  return (
    (await withStore('readwrite', async (s) => {
      const cur = sanitizeUserPreset(await done(s.get(id) as IDBRequest<unknown>));
      if (!cur) return false;
      await done(s.put({ ...cur, name: n }));
      return true;
    })) === true
  );
}

export async function deleteUserPreset(id: string): Promise<boolean> {
  return (
    (await withStore('readwrite', async (s) => {
      await done(s.delete(id));
      return true;
    })) === true
  );
}

export function exportUserPresets(presets: UserPreset[]): string {
  return JSON.stringify({ format: USER_PRESET_EXPORT_FORMAT, version: 1, presets }, null, 1);
}

export type ImportResult = { ok: true; presets: UserPreset[] } | { ok: false; reason: 'json' | 'format' | 'invalid' | 'empty' };

/** Parse an export file. Imported presets get fresh ids so they never overwrite an existing one. */
export function parseUserPresetsJson(text: string, fresh = true): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'format' };
  const d = data as Record<string, unknown>;
  if (d.format !== USER_PRESET_EXPORT_FORMAT || d.version !== 1 || !Array.isArray(d.presets)) return { ok: false, reason: 'format' };
  if (d.presets.length === 0) return { ok: false, reason: 'empty' };
  const out: UserPreset[] = [];
  for (const raw of d.presets) {
    const p = sanitizeUserPreset(raw);
    if (!p) return { ok: false, reason: 'invalid' };
    out.push(fresh ? { ...p, id: newPresetId() } : p);
  }
  return { ok: true, presets: out };
}

export async function importUserPresets(text: string): Promise<ImportResult> {
  const r = parseUserPresetsJson(text);
  if (!r.ok) return r;
  const saved: UserPreset[] = [];
  for (const p of r.presets) {
    const s = await saveUserPreset({ id: p.id, name: p.name, category: p.category, layers: p.layers, createdAt: p.createdAt });
    if (s) saved.push(s);
  }
  return { ok: true, presets: saved };
}
