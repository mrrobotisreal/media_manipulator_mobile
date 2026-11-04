/**
 * MA52 decision 5: every photo_* helper's props against the catalog (the analytics repo's
 * KnownProps, pinned in `__fixtures__/analytics-catalog.fixture.json`), the three app `source`
 * values, the preset rows' `tool_slug`, and `photo_export_gated` (tier + the web's upgrade path).
 */
import { track } from '@/analytics/track';
import type { PhotoDoc } from '@/photo/photoTypes';
import { newPhotoDoc } from '@/photo/photoTypes';
import { record } from '@/jobs/testFixtures';
import { photoExportOptions } from '@/jobs/starters/photoExport';
import { APERTURE_PRESET_ROWS } from '@/photo/entryRows';
import { TOOL_BY_ID } from '@/tools/registry';
import catalog from '../../../__fixtures__/analytics-catalog.fixture.json';
import { EVENTS } from '../events';
import {
  createAdjustmentTracker,
  photoTierProp,
  photoUpgradePath,
  trackPhotoAiMask,
  trackPhotoCompareUsed,
  trackPhotoEditorOpened,
  trackPhotoExportGated,
  trackPhotoExportSettled,
  trackPhotoExportStarted,
  trackPhotoHeal,
  trackPhotoMaskAdded,
  trackPhotoPresetApplied,
  trackPhotoProjectCreated,
  trackPhotoProjectDeleted,
  trackPhotoProjectSaved,
} from '../photoEvents';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
const calls = () =>
  (track as jest.Mock).mock.calls as [string, Record<string, unknown>, Record<string, unknown>?][];
beforeEach(() => (track as jest.Mock).mockClear());

const cat = catalog as unknown as Record<string, { priority: number; props: string[] } | undefined>;

/** Emit every photo_* event once through its helper (the app's only emission paths). */
function emitAll(doc: PhotoDoc) {
  trackPhotoEditorOpened('app_intake', true);
  trackPhotoProjectCreated('heic', 12, false);
  const adj = createAdjustmentTracker(
    (a, p) => track(EVENTS.PHOTO_ADJUSTMENT_CHANGED, { adjustment: a, param: p }),
    { set: ((fn: () => void) => (fn(), 0)) as never, clear: (() => undefined) as never },
  );
  adj.note('exposure', 'ev');
  trackPhotoMaskAdded('brush');
  const ai = trackPhotoAiMask();
  ai.completed();
  trackPhotoAiMask().failed('quota');
  const heal = trackPhotoHeal();
  heal.completed();
  trackPhotoHeal().failed('timeout');
  trackPhotoPresetApplied('bw-film', true);
  trackPhotoCompareUsed('hold');
  trackPhotoProjectSaved(doc);
  trackPhotoExportStarted(doc, 'jpg', 12);
  const opts = photoExportOptions({
    projectId: 'p',
    body: { format: 'jpg', quality: 90, metadataMode: 'keep' },
    megapixels: 12,
  });
  trackPhotoExportSettled(record({ state: 'completed', options: opts, createdAt: 0 }), 1500);
  trackPhotoExportSettled(record({ state: 'failed', options: opts, createdAt: 0 }), 1500);
  trackPhotoExportGated('megapixels', 'free', 'premium');
}

describe('MA52 photo analytics parity', () => {
  it('every photo_* name the app emits has props within the catalog KnownProps', () => {
    emitAll(newPhotoDoc(4000, 3000));
    const seen = new Set<string>();
    for (const [name, props] of calls()) {
      if (!name.startsWith('photo_')) continue;
      seen.add(name);
      const def = cat[name];
      expect(def).toBeDefined();
      for (const k of Object.keys(props ?? {}))
        expect([name, def!.props]).toEqual([name, expect.arrayContaining([k])]);
    }
    // The whole "MA52 photo" batch is emitted (MA50 + MA51 + MA52's gate).
    const batch = Object.values(EVENTS).filter((n) => n.startsWith('photo_'));
    expect([...seen].sort()).toEqual([...batch].sort());
  });

  it('photo_editor_opened.source: the app sends app_intake | app_share | history | projects', () => {
    for (const s of ['app_intake', 'app_share', 'history', 'projects'] as const)
      trackPhotoEditorOpened(s, false, 'aperture');
    expect(calls().map((c) => c[1].source)).toEqual([
      'app_intake',
      'app_share',
      'history',
      'projects',
    ]);
  });

  it('context.tool_slug of a preset row = its analyticsSlug (the MM100 page)', () => {
    for (const r of APERTURE_PRESET_ROWS) {
      expect(TOOL_BY_ID.get(r.id)!.analyticsSlug).toBe(r.slug);
      trackPhotoEditorOpened('app_intake', true, r.slug);
    }
    expect(calls().map((c) => c[2]?.tool_slug)).toEqual(APERTURE_PRESET_ROWS.map((r) => r.slug));
    expect(calls().every((c) => c[2]?.feature === 'photo')).toBe(true);
  });

  it('photo_export_gated: reason, catalog tier, the web ladder upgrade path', () => {
    const tiers = [
      { tier: 'anonymous', limits: { photoMaxMegapixels: 12, photoProjects: 0 } },
      { tier: 'free', limits: { photoMaxMegapixels: 12, photoProjects: 5 } },
      { tier: 'premium', limits: { photoMaxMegapixels: 120, photoProjects: 50 } },
      { tier: 'pro', limits: { photoMaxMegapixels: 120, photoProjects: -1 } },
    ];
    expect(photoUpgradePath('megapixels', 'free', tiers, 24)).toBe('premium');
    expect(photoUpgradePath('megapixels', 'anonymous', tiers, 64)).toBe('premium');
    expect(photoUpgradePath('megapixels', 'premium', tiers, 200)).toBe('none');
    expect(photoUpgradePath('projects', 'free', tiers)).toBe('premium');
    expect(photoUpgradePath('projects', 'premium', tiers)).toBe('pro');
    expect(photoUpgradePath('projects', 'pro', tiers)).toBe('none');
    expect(photoUpgradePath('projects', 'anonymous', tiers)).toBe('signup');
    // No served table: the ladder default (the server still clamps / refuses).
    expect(photoUpgradePath('megapixels', 'free', undefined, 24)).toBe('premium');
    expect(photoUpgradePath('projects', 'free', undefined)).toBe('premium');
    expect(photoTierProp('premium')).toBe('premium');
    expect(photoTierProp('weird')).toBe('anonymous');
    trackPhotoExportGated('projects', 'free', 'premium', 'aperture-curves');
    expect(calls()).toEqual([
      [
        'photo_export_gated',
        { reason: 'projects', tier: 'free', upgrade_path: 'premium' },
        { tool_slug: 'aperture-curves', feature: 'photo' },
      ],
    ]);
  });

  it('a deleted project is the catalog data_deleted with kind project', () => {
    trackPhotoProjectDeleted();
    expect(calls()).toEqual([
      [
        'data_deleted',
        { scope: 'item', kind: 'project' },
        { tool_slug: 'aperture', feature: 'photo' },
      ],
    ]);
    expect(cat.data_deleted!.props).toEqual(['scope', 'kind']);
  });

  it('there is no PHOTO_EVENTS_LIVE gate (MA52 decision 5)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../photoEvents') as Record<string, unknown>;
    expect(Object.keys(mod).some((k) => /LIVE/.test(k))).toBe(false);
  });
});
