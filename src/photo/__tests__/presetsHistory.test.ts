/**
 * MA51 presets and history (acceptance 3 and 4): built-ins append as one group, the Auto preset's
 * percentiles on the chart fixture, user presets round-trip through the MMKV store with the web's
 * JSON import validation, every history label in the code resolves, and the store jumps.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readImage } from '../goldens';
import { toBytes } from '../colorMath';
import { historySteps, isKnownLabel, presetLabel, resolveLabel, stepsTo } from '../history';
import { makePhotoStore, mutate, photoActions } from '../photoStore';
import { newPhotoDoc, parsePhotoDoc, type PhotoDoc } from '../photoTypes';
import { upsertAdjustment } from '../layerOps';
import { computeAutoPreset } from '../presets/autoPreset';
import {
  applyPreset,
  BUILTIN_PRESETS,
  builtinLayers,
  deleteUserPreset,
  exportPresetsJson,
  histogram256,
  importPresetsJson,
  listUserPresets,
  renameUserPreset,
  saveUserPreset,
  USER_PRESETS_KEY,
  type KvStorage,
} from '../presets/presetStore';

const kv = (): KvStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: async (k) => map.get(k), setItem: async (k, v) => void map.set(k, v) };
};

const blank = (): PhotoDoc => {
  const r = parsePhotoDoc(newPhotoDoc(256, 256));
  if (!r.ok) throw new Error(r.error);
  return r.doc;
};

describe('built-in presets', () => {
  it('every built-in has layers (Auto from a histogram) and appends as one named group', () => {
    const h = histogram256(toBytes(readImage('chart')));
    for (const p of BUILTIN_PRESETS) {
      const layers = builtinLayers(p.id, h);
      expect([p.id, !!layers && layers.length > 0]).toEqual([p.id, true]);
    }
    const d0 = upsertAdjustment(blank(), 'exposure', (p) => ({ ...p, ev: 1 })).doc;
    const d1 = applyPreset(
      d0,
      'color-pop-blue',
      builtinLayers('color-pop-blue', null)!,
      'Colour pop: blue',
    );
    const d2 = applyPreset(d1, 'vintage', builtinLayers('vintage', null)!, 'Vintage');
    const groups = [...new Set(d2.layers.map((l) => l.group).filter(Boolean))];
    expect(groups).toEqual(['Preset: Colour pop: blue', 'Preset: Vintage']);
    expect(d2.layers[0]!.type).toBe('exposure');
    expect(parsePhotoDoc(JSON.parse(JSON.stringify(d2))).ok).toBe(true);
    expect(builtinLayers('auto', null)).toBeNull();
  });

  it('Auto on the chart fixture: the 0.5 % / 99.5 % percentiles and a grey-world white balance', () => {
    const h = histogram256(toBytes(readImage('chart')));
    const r = computeAutoPreset(h);
    // The chart spans black to white in every channel.
    expect(r.levels.r[0]).toBeLessThanOrEqual(0.02);
    expect(r.levels.r[1]).toBeGreaterThanOrEqual(0.98);
    expect(r.levels.g[0]).toBeLessThanOrEqual(0.02);
    expect(r.levels.b[1]).toBeGreaterThanOrEqual(0.98);
    expect(r.layers.map((l) => l.type)).toEqual(['levels', 'whiteBalance']);
    // Same numbers as the web's computeAutoPreset over its own 256-bin histogram of the fixture.
    expect(builtinLayers('auto', h)).toEqual(r.layers);
  });

  it('histogram256 skips transparent pixels', () => {
    const h = histogram256(new Uint8Array([10, 20, 30, 0, 10, 20, 30, 255]));
    expect([h.r[10], h.g[20], h.b[30]]).toEqual([1, 1, 1]);
  });
});

describe('user presets (MMKV photoPresets, MM103 columns)', () => {
  it('save -> list -> rename -> delete round-trips, newest first, masks and groups stripped', async () => {
    const store = kv();
    let t = 0;
    const now = () => new Date(Date.UTC(2026, 10, 4, 0, 0, t++)).toISOString();
    const d = applyPreset(blank(), 'warm', builtinLayers('warm', null)!, 'Warm');
    const a = await saveUserPreset(store, { name: ' Mine ', layers: d.layers }, now);
    const b = await saveUserPreset(store, { name: 'Second', layers: d.layers }, now);
    expect(a && b).toBeTruthy();
    const list = await listUserPresets(store);
    expect(list.map((p) => p.name)).toEqual(['Second', 'Mine']);
    expect(Object.keys(list[0]!).sort()).toEqual(['category', 'createdAt', 'id', 'layers', 'name']);
    expect(list[0]!.category).toBe('custom');
    expect(list[0]!.layers.every((l) => l.mask === null && l.group === undefined)).toBe(true);
    expect(await renameUserPreset(store, a!.id, 'Renamed')).toBe(true);
    expect(await renameUserPreset(store, a!.id, '   ')).toBe(false);
    expect(await deleteUserPreset(store, b!.id)).toBe(true);
    expect((await listUserPresets(store)).map((p) => p.name)).toEqual(['Renamed']);
    expect(JSON.parse(store.map.get(USER_PRESETS_KEY)!)).toHaveLength(1);
  });

  it('export -> import gives fresh ids; a bad file is refused as a whole', async () => {
    const store = kv();
    await saveUserPreset(store, { name: 'P', layers: builtinLayers('cool', null)! });
    const json = exportPresetsJson(await listUserPresets(store));
    expect(JSON.parse(json).format).toBe('aperture-presets');
    const other = kv();
    const r = await importPresetsJson(other, json);
    expect(r.ok).toBe(true);
    const imported = await listUserPresets(other);
    expect(imported).toHaveLength(1);
    expect(imported[0]!.id).not.toBe((await listUserPresets(store))[0]!.id);
    expect(await importPresetsJson(other, '{')).toEqual({ ok: false, reason: 'json' });
    expect(await importPresetsJson(other, '{"format":"x"}')).toEqual({
      ok: false,
      reason: 'format',
    });
    expect(
      await importPresetsJson(
        other,
        JSON.stringify({ format: 'aperture-presets', version: 1, presets: [] }),
      ),
    ).toEqual({ ok: false, reason: 'empty' });
    const bad = JSON.parse(json);
    bad.presets.push({ id: 'x', name: 'bad', category: null, layers: [{ id: 'q', type: 'nope' }] });
    expect(await importPresetsJson(other, JSON.stringify(bad))).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await listUserPresets(other)).toHaveLength(1);
  });

  it('a corrupt store reads as empty', async () => {
    const store = kv();
    store.map.set(USER_PRESETS_KEY, 'not json');
    expect(await listUserPresets(store)).toEqual([]);
  });
});

describe('history labels', () => {
  /** Every label literal passed to edit(…) / mutate(store, …) / begin(…) / undoLabel in src/photo. */
  function labelsInCode(): string[] {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__' && e.name !== 'fixtures') walk(p);
        } else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    const out = new Set<string>();
    const re =
      /(?:\bedit\(|mutate\(store, |\bbegin\(|undoLabel=|\bhistoryLabel: )['"`]([A-Za-z|:.-]+)['"`]/g;
    for (const f of files) {
      if (/\/(colorMath|photoTypes|maskOps|geometryOps|healOps|layerOps|goldens)\.ts$/.test(f))
        continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(re)) out.add(m[1]!);
    }
    return [...out].sort();
  }

  it('every label the code passes resolves to a translation key', () => {
    const labels = labelsInCode();
    expect(labels.length).toBeGreaterThanOrEqual(15);
    const unknown = labels.filter((l) => !isKnownLabel(l));
    expect(unknown).toEqual([]);
  });

  it('preset labels and layer types resolve structurally', () => {
    expect(resolveLabel(presetLabel(true, 'vintage'))).toEqual({ presetBuiltin: 'vintage' });
    expect(resolveLabel(presetLabel(false, 'Mine'))).toEqual({ presetUser: 'Mine' });
    expect(resolveLabel('exposure')).toEqual({ key: 'interface:photo.layers.type.exposure' });
    expect(resolveLabel('heal')).toEqual({ key: 'interface:photo.history.labels.heal' });
  });

  it('the timeline lists applied and redoable steps, and the store jumps there', () => {
    const store = makePhotoStore();
    store.dispatch(photoActions.loaded({ projectId: 'p', doc: blank() }));
    for (const ev of [1, 2, 3])
      mutate(store, 'exposure', (d) => upsertAdjustment(d, 'exposure', (p) => ({ ...p, ev })).doc);
    store.dispatch(photoActions.undone());
    const s = store.getState();
    const steps = historySteps(s.past, s.future);
    expect(steps.map((x) => [x.index, x.applied, x.current])).toEqual([
      [1, true, false],
      [2, true, true],
      [3, false, false],
    ]);
    store.dispatch(photoActions.jumped(stepsTo(s.past.length, 0)));
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().doc!.layers).toHaveLength(0);
    store.dispatch(photoActions.jumped(stepsTo(0, 3)));
    expect(store.getState().future).toHaveLength(0);
    expect(store.getState().doc!.layers[0]!.params).toMatchObject({ ev: 3 });
    store.dispatch(photoActions.historyCleared());
    expect([store.getState().past.length, store.getState().future.length]).toEqual([0, 0]);
  });
});
